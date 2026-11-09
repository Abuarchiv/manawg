import { chromium, devices } from '@playwright/test';
import { BASE, MAIL } from './env.mjs';

const log = [];
const bugs = [];
const note = (m) => {
	log.push(m);
};
const bug = (m) => {
	bugs.push(m);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function mails(to) {
	for (let i = 0; i < 20; i++) {
		const r = await (await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
		if (r.messages?.length) {
			const out = [];
			for (const m of r.messages) out.push(await (await fetch(`${MAIL}/message/${m.ID}`)).json());
			return out;
		}
		await wait(700);
	}
	return [];
}
const stamp = Date.now();
const A = { email: `anna${stamp}@example.test`, name: 'Anna' };
const B = { email: `ben${stamp}@example.test`, name: 'Ben' };
const browser = await chromium.launch();
function watch(page, tag) {
	page.on('pageerror', (e) => bug(`${tag} pageerror ${e.message.slice(0, 160)}`));
	page.on('console', (m) => {
		if (m.type() === 'error') bug(`${tag} console ${m.text().slice(0, 160)}`);
	});
	page.on('response', (r) => {
		if (r.status() >= 500) bug(`${tag} HTTP ${r.status()} ${r.url().replace(BASE, '')}`);
	});
}
async function ctx() {
	const c = await browser.newContext({
		...devices['iPhone 13'],
		baseURL: BASE,
		locale: 'de-DE',
		timezoneId: 'Europe/Berlin',
	});
	const p = await c.newPage();
	return { c, p };
}
// Registration is name and address, then the 8-digit code from the mail on the same page.
async function register(p, u, tag) {
	await p.goto('/signup');
	await p.getByLabel('Dein Name').fill(u.name);
	await p.getByLabel('E-Mail-Adresse').fill(u.email);
	await p.getByRole('button', { name: 'Weiter', exact: true }).click();
	return enterRegistrationCode(p, u, tag);
}
async function enterRegistrationCode(p, u, tag) {
	await p.getByLabel('8-stelliger Code').waitFor({ timeout: 15000 });
	const ms = await mails(u.email);
	const code = ms[0] && (ms[0].Text ?? '').match(/\b(\d{8})\b/)?.[1];
	if (!code) {
		bug(`${tag} no code in the registration mail`);
		return false;
	}
	note(`${tag} Mail subject: ${ms[0].Subject}`);
	await p.getByLabel('8-stelliger Code').fill(code);
	await p.getByRole('button', { name: 'Konto erstellen', exact: true }).click();
	await wait(2500);
	note(`${tag} after the code: ${p.url()}`);
	return true;
}
// ---- account A
const a = await ctx();
watch(a.p, 'A');
if (!(await register(a.p, A, 'A'))) process.exit(1);
const cookies = await a.c.cookies();
note(
	`A Cookies: ${cookies.map((c) => `${c.name}${c.httpOnly ? '[httpOnly]' : '[JS]'}`).join(', ')}`,
);
if (cookies.some((c) => c.name.startsWith('sb-') && !c.httpOnly)) bug('A sb cookie not HttpOnly');
await a.p.goto('/login');
await wait(1500);
note(`A /login: ${(await a.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
// create WG
await a.p.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
const nameVal = await a.p.getByLabel('Dein Anzeigename').inputValue();
note(`A display name prefilled: ${JSON.stringify(nameVal)}`);
if (nameVal !== 'Anna') bug(`Name from sign-up not prefilled: ${nameVal}`);
await a.p.getByLabel('WG-Name').fill('Testwohnung');
await a.p.getByRole('button', { name: 'WG erstellen', exact: true }).click();
await a.p
	.waitForSelector('text=wurde erstellt', { timeout: 20000 })
	.catch(() => bug('A WG creation: no success screen'));
const linkBtn = a.p.getByRole('button', { name: 'Einladungslink kopieren' });
await a.p
	.waitForFunction(() => /invite\/[\w-]{22}/.test(document.body.innerText), null, {
		timeout: 15000,
	})
	.catch(() => {});
const inviteUrl = ((await linkBtn.textContent().catch(() => '')) ?? '').trim();
note(`A invite link: ${inviteUrl}`);
if (!/invite\/[\w-]{22}/.test(inviteUrl)) bug('Invite link missing/invalid');
const token = inviteUrl.split('/').pop();
await a.p.screenshot({ path: `${process.env.SHOTS_DIR}/real-created.png` });
// ---- account B joins
const b = await ctx();
watch(b.p, 'B');
await b.p.goto(`/invite/${token}`);
await wait(1200);
note(
	`B invite (logged out): ${(await b.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160)}`,
);
await b.p.getByRole('link', { name: 'Konto erstellen' }).click();
await wait(500);
note(`B URL: ${b.p.url()}`);
await b.p.getByLabel('Dein Name').fill(B.name);
await b.p.getByLabel('E-Mail-Adresse').fill(B.email);
await b.p.getByRole('button', { name: 'Weiter', exact: true }).click();
if (!(await enterRegistrationCode(b.p, B, 'B'))) process.exit(1);
await wait(1000);
note(`B after registration: ${b.p.url()}`);
if (!/invite/.test(b.p.url()))
	bug(`B does not land on the invite after registration: ${b.p.url()}`);
else {
	note(
		`B join page: ${(await b.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`,
	);
	await b.p.getByRole('button', { name: 'Beitreten', exact: true }).click();
	await wait(2500);
	note(`B after joining: ${b.p.url()}`);
	if (!/\/wg\//.test(b.p.url())) bug(`B not in the WG after joining: ${b.p.url()}`);
}
const wgPath = new URL(b.p.url()).pathname.split('/').slice(0, 3).join('/');
note(`WG path: ${wgPath}`);
// ---- Create data via UI: shopping
await a.p.goto(`${wgPath}/shopping`);
await wait(1500);
await a.p.getByPlaceholder(/Reis/).fill('Hafermilch');
await a.p.keyboard.press('Enter');
await wait(1500);
note(`A shopping: ${(await a.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160)}`);
await b.p.goto(`${wgPath}/shopping`);
await wait(2000);
if (!(await b.p.locator('text=Hafermilch').count())) bug("B does not see Anna's Hafermilch");
// Chores + expense via UI take long; load the dashboard instead
for (const sub of [
	'',
	'/expenses',
	'/chores',
	'/chat',
	'/pinboard',
	'/calendar',
	'/settings',
	'/statement',
	'/activity',
]) {
	for (const [who, pg] of [
		['A', a.p],
		['B', b.p],
	]) {
		await pg.goto(wgPath + sub);
		await wait(900);
		// The settings page links "Fehler per E-Mail melden"; that is not an error state.
		const t = (await pg.locator('body').innerText()).replace(/Fehler per E-Mail melden/g, '');
		if (/Fehler|konnte nicht|nicht geladen/i.test(t))
			bug(
				`${who} ${sub || '/'} shows error text: ${t.match(/[^\n]*(Fehler|konnte nicht|nicht geladen)[^\n]*/i)?.[0] ?? ''}`,
			);
	}
}
// ---- Sign out + code login A
await a.p.goto(`${wgPath}/settings`);
await wait(1000);
await a.p.screenshot({ path: `${process.env.SHOTS_DIR}/real-settings.png` });
const out = await a.p.evaluate(
	async () =>
		(
			await fetch('/api/auth/sign-out', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			})
		).status,
);
note(`A sign-out status ${out}`);
await a.p.goto('/login');
await wait(1200);
note(
	`A after sign-out /login: ${(await a.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 120)}`,
);
await a.p.getByLabel('E-Mail-Adresse').fill(A.email);
await a.p.getByRole('button', { name: 'Code per E-Mail senden' }).click();
await wait(1500);
const _before = (await mails(A.email)).length;
await wait(1500);
const codeMail = (await mails(A.email)).find((m) =>
	/\b\d{8}\b/.test(m.Text + m.HTML.replace(/<[^>]+>/g, ' ')),
);
const code = `${codeMail?.Text} ${codeMail?.HTML.replace(/<[^>]+>/g, ' ')}`.match(
	/\b(\d{8})\b/,
)?.[1];
note(`A code mail: ${codeMail ? codeMail.Subject : 'NONE'} code=${code}`);
if (!code) bug('Code login: no 8-digit code mail');
else {
	await a.p.getByLabel(/stelliger Code/).fill(code);
	await a.p.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await wait(2500);
	note(`A after code login: ${a.p.url()}`);
}
if (/\/login$/.test(a.p.url()) || !/\/wg\//.test(a.p.url()))
	note(`A does not land in a WG automatically (ok if selection): ${a.p.url()}`);
// Reload persistence
await a.p.reload();
await wait(1500);
note(
	`A after reload: ${a.p.url()} signedIn-Cookie: ${(await a.c.cookies()).some((c) => c.name === 'manawg_signed_in')}`,
);
if (process.env.VERBOSE === '1') for (const line of log) process.stdout.write(`${line}\n`);
for (const entry of bugs) process.stdout.write(`- ${entry}\n`);
await browser.close();
