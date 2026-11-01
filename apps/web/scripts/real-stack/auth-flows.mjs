// E-mail-code login (code read from Mailpit), invitation by mail (ledger), receipt upload through
// Supabase Storage with access checks and revocation after the expense is deleted, and a password
// set before the address is confirmed (pre-registration) that must not survive the confirmation.
import { randomUUID } from 'node:crypto';
import { chromium, devices, request } from '@playwright/test';
import { MAIL } from './env.mjs';
import { BASE, call, expect, finish, SB, SERVICE, setup, sql, user } from './modules-lib.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mailFor = async (email, tries = 20) => {
	for (let i = 0; i < tries; i += 1) {
		const s = await (
			await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${email}`)}`)
		).json();
		if (s.messages?.length) return (await fetch(`${MAIL}/message/${s.messages[0].ID}`)).json();
		await wait(500);
	}
	return null;
};

// 1 E-mail code login in the browser
const email = `code${Date.now()}@example.test`;
await fetch(`${SB}/auth/v1/admin/users`, {
	method: 'POST',
	headers: {
		apikey: SERVICE,
		authorization: `Bearer ${SERVICE}`,
		'content-type': 'application/json',
	},
	body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: 'Codi' } }),
});
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
const p = await ctx.newPage();
const bad = [];
p.on('response', (r) => {
	if (r.status() >= 500) bad.push(`${r.status()} ${r.url()}`);
});
await p.goto('/login');
await p.waitForLoadState('networkidle');
await p.locator('#auth-code-email').fill(email);
await p.getByRole('button', { name: 'Code per E-Mail senden' }).click();
await p.locator('#auth-code').waitFor({ timeout: 15_000 });
const m = await mailFor(email);
const code = m?.Text?.match(/\b(\d{8})\b/)?.[1] ?? m?.HTML?.match(/\b(\d{8})\b/)?.[1];
expect(!!code, 'code mail with 8 digits arrived', m?.Subject ?? 'no mail');
await p.locator('#auth-code').fill('00000000');
await p.getByRole('button', { name: 'Anmelden', exact: true }).click();
await wait(1500);
const wrong = await p.locator('main').innerText();
expect(
	/ungültig|falsch|abgelaufen|nicht/i.test(wrong),
	'wrong code shows error text',
	wrong.slice(0, 80),
);
await p.locator('#auth-code').fill(code ?? '');
await p.getByRole('button', { name: 'Anmelden', exact: true }).click();
await p
	.getByText(/WG erstellen|Neue WG|Deine WGs/i)
	.first()
	.waitFor({ timeout: 15_000 });
const signedIn = (await ctx.cookies()).some(
	(c) => c.name === 'manawg_signed_in' && c.value === '1',
);
expect(signedIn, 'signed in after code login (hint cookie)');
expect(bad.length === 0, 'no 5xx during code login', bad.join(' | '));
await browser.close();

// 2 Invitation by mail: ledger row, no duplicate for the same recipient
const { A, B, code: wg } = await setup();
const inv = await call(A, 'POST', `/api/wg/${wg}/invitations`, { email: 'gast@example.test' });
expect(
	inv.status < 300,
	'invitation by mail accepted',
	`${inv.status} ${JSON.stringify(inv.body)}`,
);
const row = sql(
	`select status from mail_log where kind='invitation' order by created_at desc limit 1`,
);
expect(['sent', 'deferred', 'sending'].includes(row), 'invitation mail in ledger', row);
const inv2 = await call(A, 'POST', `/api/wg/${wg}/invitations`, { email: 'GAST@example.test' });
expect(
	inv2.status < 300 || inv2.status === 429,
	'second invitation to the same address without 5xx',
	String(inv2.status),
);
const invBad = await call(A, 'POST', `/api/wg/${wg}/invitations`, { email: 'kein-mail' });
expect(invBad.status === 400, 'invalid address 400', String(invBad.status));

// 3 Receipt upload through Supabase Storage
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64',
);
const sign = await call(A, 'POST', '/api/upload/sign', {
	shareCode: wg,
	purpose: 'expense',
	mimeType: 'image/png',
	fileSize: png.length,
});
expect(
	sign.status === 200 && !!sign.body.presignedUrl,
	'upload signed',
	JSON.stringify(sign.body).slice(0, 120),
);
const badMime = await call(A, 'POST', '/api/upload/sign', {
	shareCode: wg,
	purpose: 'expense',
	mimeType: 'text/html',
	fileSize: 10,
});
expect(badMime.status === 400, 'text/html rejected', String(badMime.status));
const tooBig = await call(A, 'POST', '/api/upload/sign', {
	shareCode: wg,
	purpose: 'expense',
	mimeType: 'image/png',
	fileSize: 9 * 1024 * 1024,
});
expect(tooBig.status === 400, '9 MB rejected', String(tooBig.status));
const put = await fetch(sign.body.presignedUrl, {
	method: 'PUT',
	headers: { ...sign.body.uploadHeaders, 'content-type': 'image/png' },
	body: png,
});
expect(
	put.status === 200,
	'PUT into the bucket',
	`${put.status} ${(await put.text()).slice(0, 80)}`,
);
const url = sign.body.publicUrl;
const readA = await A.ctx.fetch(url);
expect(
	readA.status() === 200 && readA.headers()['content-type'] === 'image/png',
	'member reads image',
	`${readA.status()} ${readA.headers()['content-type']}`,
);
expect((readA.headers()['cache-control'] ?? '').includes('no-store'), 'image without cache');
const readB = await B.ctx.fetch(url);
expect(readB.status() === 200, 'flatmate reads image', String(readB.status()));
const C = await user('Fremd');
const readC = await C.ctx.fetch(url);
const readCBody = await readC.json().catch(() => ({}));
expect(
	readC.status() === 401 && readCBody.code === 'not_a_member',
	'stranger gets no image (401 not_a_member, no session banner)',
	`${readC.status()} ${JSON.stringify(readCBody)}`,
);
const anon = await request.newContext({ baseURL: BASE });
const readAnon = await anon.fetch(url);
expect(readAnon.status() === 401, 'without login 401', String(readAnon.status()));
const readBadKey = await A.ctx.fetch(
	`/api/upload/read?key=${encodeURIComponent('../../etc/passwd')}`,
);
expect(readBadKey.status() === 400, 'broken key 400', String(readBadKey.status()));
const members = await call(A, 'GET', `/api/wg/${wg}/members`);
const ids = members.body.members.map((x) => x.id);
const ex = await call(A, 'POST', `/api/wg/${wg}/expenses`, {
	amountCents: 1000,
	description: 'Beleg',
	category: 'groceries',
	paidByMemberId: ids[0],
	splits: ids.map((id) => ({ debtorMemberId: id, amountCents: 500 })),
	imageUrl: url,
});
expect(
	ex.status < 300,
	'expense with receipt',
	`${ex.status} ${JSON.stringify(ex.body).slice(0, 100)}`,
);
const foreign = await call(A, 'POST', `/api/wg/${wg}/expenses`, {
	amountCents: 1000,
	description: 'Fremdbild',
	category: 'groceries',
	paidByMemberId: ids[0],
	splits: ids.map((id) => ({ debtorMemberId: id, amountCents: 500 })),
	imageUrl: `/api/upload/read?key=${encodeURIComponent(`manawg/${randomUUID()}/expense/${randomUUID()}.png`)}`,
});
expect(foreign.status === 400, 'image of another WG on expense rejected', String(foreign.status));
const exId = ex.body.expense?.id ?? ex.body.id;
const del = await call(A, 'DELETE', `/api/wg/${wg}/expenses/${exId}`, {});
expect(del.status < 300, 'expense deleted', String(del.status));
const readAfter = await A.ctx.fetch(url);
expect(readAfter.status() === 404, 'image revoked after delete', String(readAfter.status()));
// 4 A password set before the address is confirmed never becomes a working credential
const PUBLISHABLE = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const json = { 'content-type': 'application/json' };
const mailLinks = async (address, count) => {
	for (let i = 0; i < 30; i += 1) {
		const found = await (
			await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${address}`)}`)
		).json();
		if ((found.messages?.length ?? 0) >= count) {
			const mail = await (await fetch(`${MAIL}/message/${found.messages[0].ID}`)).json();
			const href = (mail.HTML ?? '').match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1];
			return href?.replaceAll('&amp;', '&');
		}
		await wait(500);
	}
	return undefined;
};
const passwordLogin = async (address, password) =>
	(
		await fetch(`${SB}/auth/v1/token?grant_type=password`, {
			method: 'POST',
			headers: { apikey: PUBLISHABLE, ...json },
			body: JSON.stringify({ email: address, password }),
		})
	).json();
const preRegister = async (address, password) => {
	const res = await fetch(`${SB}/auth/v1/signup`, {
		method: 'POST',
		headers: { apikey: PUBLISHABLE, ...json },
		body: JSON.stringify({ email: address, password }),
	});
	expect(res.ok, 'direct sign-up against Supabase accepted', String(res.status));
};
const victimApi = async () =>
	request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
const pendingFlag = (address) =>
	sql(`select raw_app_meta_data->>'password_pending' from auth.users where email='${address}'`);

// 4a The squatter registers the address, the owner signs up again and confirms
const squatted = `squat${Date.now()}@example.test`;
await preRegister(squatted, 'squatter-password-1');
await wait(1500);
const owner = await victimApi();
const ownerSignUp = await owner.post('/api/auth/sign-up', {
	data: { email: squatted, password: 'owner-password-2', name: 'Owner', next: '/' },
});
expect(ownerSignUp.ok(), 'sign-up of the owner accepted', String(ownerSignUp.status()));
const squatLink = await mailLinks(squatted, 2);
expect(!!squatLink, 'two confirmation mails for the squatted address');
await owner.get(squatLink);
const squatLogin = await passwordLogin(squatted, 'squatter-password-1');
expect(
	squatLogin.error_code === 'invalid_credentials',
	'password set before the confirmation does not log in',
	JSON.stringify(squatLogin).slice(0, 120),
);
expect(pendingFlag(squatted) === 'true', 'confirmed account is flagged password_pending');

// 4b The squatter registers, the owner asks for a sign-in code and uses the mailed link
const coded = `coded${Date.now()}@example.test`;
await preRegister(coded, 'squatter-password-1');
await wait(1500);
const codeRequest = await (await victimApi()).post('/api/auth/code-request', {
	data: { email: coded },
});
expect(codeRequest.ok(), 'code request for the pre-registered address accepted');
const codedLink = await mailLinks(coded, 2);
expect(!!codedLink, 'confirmation mail after the code request');
await fetch(codedLink, { redirect: 'manual' });
const codedLogin = await passwordLogin(coded, 'squatter-password-1');
expect(
	codedLogin.error_code === 'invalid_credentials',
	'password set before a code-request confirmation does not log in',
	JSON.stringify(codedLogin).slice(0, 120),
);

// 4c A single sign-up: confirm, land on the page that chooses a password, sign in with it
const regular = `regular${Date.now()}@example.test`;
const regularCtx = await victimApi();
await regularCtx.post('/api/auth/sign-up', {
	data: { email: regular, password: 'first-password-3', name: 'Regular', next: '/' },
});
const regularLink = await mailLinks(regular, 1);
const landing = await regularCtx.get(regularLink ?? SB);
expect(
	landing.url().endsWith('/auth/reset?choose=1'),
	'confirmation lands on the choose-a-password page',
	landing.url(),
);
const chosen = await regularCtx.post('/api/auth/password', {
	data: { password: 'chosen-password-4' },
});
expect(chosen.ok(), 'password chosen after the confirmation', String(chosen.status()));
const chosenLogin = await passwordLogin(regular, 'chosen-password-4');
expect(!!chosenLogin.access_token, 'sign-in with the chosen password works');
expect(
	(await passwordLogin(regular, 'first-password-3')).error_code === 'invalid_credentials',
	'password from before the confirmation stays dead',
);
expect(pendingFlag(regular) === '', 'choosing a password clears the flag', pendingFlag(regular));

// 4d Accounts created confirmed keep their password
const adminMade = `admin${Date.now()}@example.test`;
await fetch(`${SB}/auth/v1/admin/users`, {
	method: 'POST',
	headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, ...json },
	body: JSON.stringify({ email: adminMade, email_confirm: true, password: 'admin-password-5' }),
});
expect(
	!!(await passwordLogin(adminMade, 'admin-password-5')).access_token,
	'confirmed-at-creation account keeps its password',
);
finish();
