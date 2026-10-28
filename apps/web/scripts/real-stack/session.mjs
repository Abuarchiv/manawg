import { chromium, devices } from '@playwright/test';
import { BASE, MAIL, SB } from './env.mjs';

// Service key of the local `supabase start` stack: `supabase status -o env` prints it.
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (see supabase status -o env)');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bugs = [];
const bug = (m) => {
	bugs.push(m);
};
const stamp = Date.now();
const email = `sess${stamp}@example.test`;
const pw = 'Sicheres-Passwort-77';
await fetch(`${SB}/auth/v1/admin/users`, {
	method: 'POST',
	headers: {
		apikey: SERVICE,
		authorization: `Bearer ${SERVICE}`,
		'content-type': 'application/json',
	},
	body: JSON.stringify({
		email,
		password: pw,
		email_confirm: true,
		user_metadata: { full_name: 'Sess' },
	}),
});
const browser = await chromium.launch();
const c = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
const p = await c.newPage();
// 1 password login wrong/right
await p.goto('/login');
await p.getByRole('tab', { name: 'Passwort' }).click();
await p.getByLabel('E-Mail-Adresse').fill(email);
await p.locator('#auth-password').fill('falsch-falsch-1');
await p.getByRole('button', { name: 'Anmelden', exact: true }).click();
await wait(1500);
if (!/E-Mail oder Passwort/.test(await p.locator('main').innerText()))
	bug('falsches Passwort ohne Fehlertext');
await p.locator('#auth-password').fill(pw);
await p.getByRole('button', { name: 'Anmelden', exact: true }).click();
await wait(2500);
// 2 expired access token: the server has to renew it via the refresh token
const ck = await c.cookies();
const tokenCookie = ck.find((x) => /^sb-.*-auth-token$/.test(x.name));
const raw = decodeURIComponent(tokenCookie.value).replace(/^base64-/, '');
const sess = JSON.parse(Buffer.from(raw, 'base64').toString());
const oldAccess = sess.access_token;
sess.access_token = `${oldAccess.slice(0, -4)}XXXX`;
sess.expires_at = 1;
sess.expires_in = 0;
await c.addCookies([
	{ ...tokenCookie, value: `base64-${Buffer.from(JSON.stringify(sess)).toString('base64url')}` },
]);
const _r = await p.evaluate(
	async () => (await fetch('/api/wg/mine', { cache: 'no-store' })).status,
);
await p.goto('/login');
await wait(1500);
const ck2 = await c.cookies();
const t2 = ck2.find((x) => /^sb-.*-auth-token$/.test(x.name));
const s2 = JSON.parse(
	Buffer.from(decodeURIComponent(t2.value).replace(/^base64-/, ''), 'base64').toString(),
);
if (s2.access_token === sess.access_token) bug('abgelaufenes Token wurde nicht erneuert');
// 3 forgot password
const p2 = await (await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE })).newPage();
await p2.goto('/login');
await p2.getByRole('tab', { name: 'Passwort' }).click();
await p2.getByLabel('E-Mail-Adresse').fill(email);
await p2.getByRole('button', { name: 'Passwort vergessen?' }).click();
await wait(2500);
let rm;
for (let i = 0; i < 15 && !rm; i++) {
	const s = await (
		await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${email} subject:Passwort`)}`)
	).json();
	if (s.messages?.length) rm = await (await fetch(`${MAIL}/message/${s.messages[0].ID}`)).json();
	else await wait(700);
}
if (!rm) {
	const _s = await (
		await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${email}`)}`)
	).json();
}
const link = rm?.HTML.match(/href="([^"]*auth[^"]*)"/)?.[1]?.replace(/&amp;/g, '&');
if (link) {
	await p2.goto(link);
	await wait(2500);
	await p2.getByLabel('Neues Passwort').fill('Neues-Passwort-99');
	const wh = p2.getByLabel(/wiederholen|bestätigen/i);
	if (await wh.count()) await wh.first().fill('Neues-Passwort-99');
	await p2.getByRole('button', { name: 'Passwort speichern' }).click();
	await wait(2500);
	const login = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
		method: 'POST',
		headers: {
			apikey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
			'content-type': 'application/json',
		},
		body: JSON.stringify({ email, password: 'Neues-Passwort-99' }),
	});
	if (login.status !== 200) bug('neues Passwort funktioniert nicht');
} else bug('keine Reset-Mail/Link');
await browser.close();
