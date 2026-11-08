// Registration with an e-mail code (name + address, 8-digit code from the mail on the same page):
// new address, wrong / reused / expired code, the same answer for an address that already has an
// account, the send-frequency limit, a password pre-set by someone else before the owner registers,
// choosing a password afterwards, and (with REAL_STACK_VERIFY_LIMIT=1 and the Auth service started
// with GOTRUE_RATE_LIMIT_VERIFY=40) the limit on wrong codes. Returning to an invitation after
// registration is covered by journey.mjs.
import { chromium, devices, request } from '@playwright/test';
import { MAIL } from './env.mjs';
import { BASE, expect, finish, SB, SERVICE, sql } from './modules-lib.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PUBLISHABLE = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const json = { 'content-type': 'application/json' };
const stamp = Date.now();
const address = (tag) => `${tag}${stamp}@example.test`;

// The newest mail to `to` whose subject matches, once at least `count` such mails have arrived
// (the welcome mail after sign-in and the code mails share the inbox).
async function mailAt(to, subject, count = 1, tries = 30) {
	for (let i = 0; i < tries; i += 1) {
		const found = await (
			await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${to}`)}`)
		).json();
		const matching = (found.messages ?? []).filter((m) => subject.test(m.Subject));
		if (matching.length >= count) return (await fetch(`${MAIL}/message/${matching[0].ID}`)).json();
		await wait(500);
	}
	return null;
}
const CONFIRM = /Bestätige deine E-Mail-Adresse/;
const SIGN_IN = /Anmeldecode/;
const RECOVERY = /Neues Passwort/;
const codeOf = (mail) => (mail?.Text ?? '').match(/\b(\d{8})\b/)?.[1];
const linkOf = (mail) =>
	(mail?.HTML ?? '').match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
const api = () => request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
const passwordLogin = async (email, password) =>
	(
		await fetch(`${SB}/auth/v1/token?grant_type=password`, {
			method: 'POST',
			headers: { apikey: PUBLISHABLE, ...json },
			body: JSON.stringify({ email, password }),
		})
	).json();
const userRow = (email, column) => sql(`select ${column} from auth.users where email='${email}'`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE, locale: 'de-DE' });
const p = await ctx.newPage();
const serverErrors = [];
p.on('response', (r) => {
	if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
});

// 1 New address in the browser: name + address, the code on the same page
const fresh = address('neu');
await p.goto('/signup');
await p.waitForLoadState('networkidle');
expect((await p.getByLabel('Passwort').count()) === 0, 'registration form has no password field');
await p.getByLabel('Dein Name').fill('Neu Nutzer');
await p.getByLabel('E-Mail-Adresse').fill(fresh);
await p.getByRole('button', { name: 'Weiter', exact: true }).click();
await p.locator('#auth-code').waitFor({ timeout: 15_000 });
expect(true, 'code step appears on the same page', p.url());
const mail = await mailAt(fresh, CONFIRM);
const code = codeOf(mail);
expect(!!code, 'registration mail carries an 8-digit code', mail?.Subject ?? 'no mail');
expect(!!linkOf(mail), 'registration mail still carries the confirmation link');
expect(
	(mail?.HTML ?? '').includes('lang="de"'),
	'mail follows the browser language',
	mail?.HTML?.slice(0, 60),
);
await p.locator('#auth-code').fill('00000000');
await p.getByRole('button', { name: 'Konto erstellen', exact: true }).click();
await p.locator('#auth-code-error').waitFor({ timeout: 10_000 });
expect(
	/falsch|abgelaufen/i.test(await p.locator('#auth-code-error').innerText()),
	'wrong code shows the error text',
);
expect(userRow(fresh, 'email_confirmed_at') === '', 'wrong code does not confirm the address');
await p.locator('#auth-code').fill(code ?? '');
await p.getByRole('button', { name: 'Konto erstellen', exact: true }).click();
await p.waitForURL((url) => !url.pathname.startsWith('/signup'), { timeout: 15_000 });
const hint = (await ctx.cookies()).some((c) => c.name === 'manawg_signed_in' && c.value === '1');
expect(hint, 'signed in after the code (hint cookie)');
expect(userRow(fresh, 'email_confirmed_at') !== '', 'code confirms the address');
expect(
	userRow(fresh, `coalesce(encrypted_password, '')`) === '',
	'code registration stores no password',
);
expect(
	userRow(fresh, `raw_user_meta_data->>'full_name'`) === 'Neu Nutzer',
	'name is stored in the account metadata',
);
expect(
	userRow(fresh, `raw_user_meta_data->>'locale'`) === 'de',
	'language is stored in the account metadata',
);
expect(
	!/\/auth\/reset/.test(p.url()),
	'a code registration is not sent to choose a password',
	p.url(),
);
const reuse = await (await api()).post('/api/auth/code-verify', {
	data: { email: fresh, token: code },
});
expect(
	reuse.status() >= 400 && reuse.status() < 500,
	'a used code does not work a second time',
	String(reuse.status()),
);

// 2 Choose a password afterwards: the settings row mails a link that sets it
const settingsApi = ctx.request;
const resetRequest = await settingsApi.post('/api/auth/password-reset', {
	data: { email: fresh },
	headers: { origin: BASE },
});
expect(resetRequest.ok(), 'password link requested for a code-registered account');
const resetMail = await mailAt(fresh, RECOVERY);
const resetLink = linkOf(resetMail);
expect(!!resetLink, 'password mail carries a link', resetMail?.Subject ?? 'no mail');
await p.goto(resetLink ?? SB);
await p.waitForURL(/\/auth\/reset/, { timeout: 15_000 });
await p.getByLabel('Neues Passwort').fill('gewaehltes-passwort-1');
await p.getByLabel('Passwort bestätigen').fill('gewaehltes-passwort-1');
await p.getByRole('button', { name: 'Passwort speichern' }).click();
await wait(2500);
expect(
	!!(await passwordLogin(fresh, 'gewaehltes-passwort-1')).access_token,
	'password chosen after a code registration works for sign-in',
);

// 3 The answer is the same for a new and an existing address
const existing = address('vorhanden');
await fetch(`${SB}/auth/v1/admin/users`, {
	method: 'POST',
	headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, ...json },
	body: JSON.stringify({
		email: existing,
		email_confirm: true,
		user_metadata: { full_name: 'Codi' },
	}),
});
const anon = await api();
const newAnswer = await anon.post('/api/auth/code-request', {
	data: { email: address('parity'), name: 'Pari' },
});
const knownAnswer = await anon.post('/api/auth/code-request', {
	data: { email: existing, name: 'Eindringling' },
});
expect(
	newAnswer.status() === knownAnswer.status() &&
		JSON.stringify(await newAnswer.json()) === JSON.stringify(await knownAnswer.json()),
	'registration answers alike for a new and an existing address',
	`${newAnswer.status()} ${knownAnswer.status()}`,
);
const knownMail = await mailAt(existing, SIGN_IN);
expect(
	/Anmeldecode/.test(knownMail?.Subject ?? ''),
	'an existing account gets its sign-in code mail',
	knownMail?.Subject ?? 'no mail',
);
const knownVerify = await (await api()).post('/api/auth/code-verify', {
	data: { email: existing, token: codeOf(knownMail) },
});
expect(knownVerify.ok(), 'the code signs the existing account in', String(knownVerify.status()));
expect(
	userRow(existing, `raw_user_meta_data->>'full_name'`) === 'Codi',
	'registering with an existing address does not change its name',
);

// 4 Expired code: refused, a new code works
const stale = address('abgelaufen');
const staleApi = await api();
await staleApi.post('/api/auth/code-request', { data: { email: stale, name: 'Alt' } });
const staleCode = codeOf(await mailAt(stale, CONFIRM));
expect(!!staleCode, 'mail for the expiry case arrived');
sql(
	`update auth.users set confirmation_sent_at = now() - interval '2 hours' where email='${stale}'`,
);
const expired = await staleApi.post('/api/auth/code-verify', {
	data: { email: stale, token: staleCode },
});
expect(
	expired.status() === 403 && (await expired.json()).code === 'otp_expired',
	'an expired code is refused with otp_expired',
	`${expired.status()}`,
);
expect(userRow(stale, 'email_confirmed_at') === '', 'an expired code does not confirm the address');
await staleApi.post('/api/auth/code-request', { data: { email: stale, name: 'Alt' } });
const newCode = await (async () => {
	for (let i = 0; i < 20; i += 1) {
		const m = await mailAt(stale, CONFIRM, 2, 1);
		if (m && codeOf(m) !== staleCode) return codeOf(m);
		await wait(500);
	}
	return undefined;
})();
expect(!!newCode && newCode !== staleCode, 'a new code is mailed after the old one expired');
const renewed = await staleApi.post('/api/auth/code-verify', {
	data: { email: stale, token: newCode },
});
expect(renewed.ok(), 'the new code registers the account', String(renewed.status()));

// 5 Send frequency: a second code for the same address within a minute is refused
const quick = address('schnell');
const quickApi = await api();
const first = await quickApi.post('/api/auth/code-request', {
	data: { email: quick, name: 'Fix' },
});
const second = await quickApi.post('/api/auth/code-request', {
	data: { email: quick, name: 'Fix' },
});
expect(first.ok(), 'first code request accepted', String(first.status()));
expect(
	second.status() === 429,
	'second code request within the send frequency answers 429',
	`${second.status()} ${(await second.text()).slice(0, 80)}`,
);
await p.context().clearCookies();
await p.goto('/signup');
await p.waitForLoadState('networkidle');
await p.getByLabel('Dein Name').fill('Fix');
await p.getByLabel('E-Mail-Adresse').fill(quick);
await p.getByRole('button', { name: 'Weiter', exact: true }).click();
await p.locator('#auth-code-error').waitFor({ timeout: 10_000 });
expect(
	/Zu viele Versuche/.test(await p.locator('#auth-code-error').innerText()),
	'the page explains the rate limit',
);

// 6 A password set by someone else before the owner registers never works
const squatted = address('besetzt');
const pre = await fetch(`${SB}/auth/v1/signup`, {
	method: 'POST',
	headers: { apikey: PUBLISHABLE, ...json },
	body: JSON.stringify({ email: squatted, password: 'squatter-password-1' }),
});
expect(pre.ok, 'direct sign-up against Supabase accepted', String(pre.status));
// Auth throttles a second mail to the same address within a minute; the squatter's mail just counted.
sql(
	`update auth.users set confirmation_sent_at = now() - interval '2 minutes' where email='${squatted}'`,
);
const owner = await api();
const ownerRequest = await owner.post('/api/auth/code-request', {
	data: { email: squatted, name: 'Besitzer' },
});
expect(
	ownerRequest.ok(),
	'owner registers a pre-registered address',
	String(ownerRequest.status()),
);
const ownerCode = codeOf(await mailAt(squatted, CONFIRM, 2));
expect(!!ownerCode, 'owner gets a code for the pre-registered address');
const ownerVerify = await owner.post('/api/auth/code-verify', {
	data: { email: squatted, token: ownerCode },
});
const ownerBody = await ownerVerify.json();
expect(
	ownerVerify.ok() && ownerBody.sessionEstablished === true,
	'owner is signed in by the code',
	JSON.stringify(ownerBody),
);
expect(
	ownerBody.passwordPending === true,
	'the account is sent to choose its own password',
	JSON.stringify(ownerBody),
);
expect(
	(await passwordLogin(squatted, 'squatter-password-1')).error_code === 'invalid_credentials',
	'the password set before the confirmation does not log in',
);

// 7 Wrong codes are limited (Auth started with GOTRUE_RATE_LIMIT_VERIFY=40)
if (process.env.REAL_STACK_VERIFY_LIMIT === '1') {
	const guessed = address('raten');
	const guessApi = await api();
	await guessApi.post('/api/auth/code-request', { data: { email: guessed, name: 'Rat' } });
	const statuses = [];
	for (let i = 0; i < 60; i += 1) {
		const res = await guessApi.post('/api/auth/code-verify', {
			data: { email: guessed, token: String(10_000_000 + i) },
		});
		statuses.push(res.status());
	}
	expect(statuses.includes(429), 'wrong codes run into the verify limit', statuses.join(','));
	expect(
		statuses.every((s) => s === 403 || s === 429 || s === 422),
		'wrong codes answer 4xx only',
		statuses.join(','),
	);
}

expect(serverErrors.length === 0, 'no 5xx during registration', serverErrors.join(' | '));
await browser.close();
finish();
