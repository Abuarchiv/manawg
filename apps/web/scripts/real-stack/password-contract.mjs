// New-password contract between the reset form and the GoTrue image of the Docker stack. Run by
// `./docker/smoke.sh password-contract` against a running `docker compose` instance with Mailpit:
//
//   APP_URL=http://localhost MAILPIT_URL=http://localhost:8025 node scripts/real-stack/password-contract.mjs
//
// Each password goes through the real form on /auth/reset in Chromium, after a sign-up confirmed
// through Mailpit. Whether the form sent it (or stopped it with the length hint) must match what
// GoTrue itself says about the same password. GoTrue is asked directly from inside the stack, not
// through the app, and a rejection counts only when GoTrue names "length" among its reasons, so
// neither the app's breach check nor GoTrue's own (GOTRUE_PASSWORD_HIBP_ENABLED) can stand in for
// a length verdict; a breach alone fails the run. Accepted candidates are random.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { chromium, request } from '@playwright/test';

const APP = process.env.APP_URL;
const MAIL = process.env.MAILPIT_URL;
if (!APP || !MAIL) throw new Error('Set APP_URL and MAILPIT_URL.');

const fail = (message) => {
	console.error(`FAIL: ${message}`);
	process.exit(1);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (n) => randomBytes(n).toString('hex');
const emoji = (n) =>
	String.fromCodePoint(...Array.from({ length: n }, () => 0x1f300 + randomInt(0x300)));

// GoTrue's own verdict, from the app container (the gateway does not expose /signup). A fresh
// address each time; an accepted password leaves an unconfirmed throwaway account.
function gotrue(password) {
	const probe = `fetch('http://auth:9999/signup', { method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }) })
		.then(async (r) => console.log(JSON.stringify({ status: r.status, body: await r.json() })))`;
	const out = execFileSync(
		'docker',
		[
			'compose',
			'exec',
			'-T',
			'-e',
			`EMAIL=contract-${hex(6)}@example.test`,
			'-e',
			`PASSWORD=${password}`,
			'app',
			'node',
			'-e',
			probe,
		],
		{ encoding: 'utf8', timeout: 30_000 },
	);
	const { status, body } = JSON.parse(out);
	if (status === 200) return 'accepted';
	const reasons = body.weak_password?.reasons ?? [];
	// GoTrue lists every reason; a short password can also be breached ("pwned"). Only "length"
	// is a length verdict, a breach alone must not pass for one.
	if (status === 422 && body.error_code === 'weak_password' && reasons.includes('length'))
		return 'rejected';
	fail(`GoTrue gave no length verdict: ${status} ${JSON.stringify(body)}`);
}

async function mailLink(to) {
	for (let i = 0; i < 30; i += 1) {
		const found = await (
			await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
		).json();
		const id = found.messages?.[0]?.ID;
		if (id) {
			const text = (await (await fetch(`${MAIL}/api/v1/message/${id}`)).json()).Text ?? '';
			return text.match(/https?:\/\/\S+\/auth\/v1\/verify\?\S+/)?.[0];
		}
		await wait(1000);
	}
}

const browser = await chromium.launch();

// A confirmed account in its own browser context, on the choose-a-password page. Sign-up runs in
// that context too: the confirmation link needs the PKCE verifier cookie it sets.
async function confirmedAccount() {
	const email = `contract-${hex(4)}@example.test`;
	const context = await browser.newContext({ baseURL: APP });
	const signUp = await context.request.post('/api/auth/sign-up', {
		headers: { origin: APP },
		data: { email, password: `Contract-${hex(12)}!`, name: 'Contract', next: '/login' },
	});
	if (!signUp.ok()) fail(`sign-up answered ${signUp.status()} ${await signUp.text()}`);
	const link = await mailLink(email);
	if (!link) fail(`no confirmation link for ${email} in Mailpit`);
	const page = await context.newPage();
	await page.goto(link);
	if (!page.url().startsWith(`${APP}/auth/reset?choose=1`))
		fail(`confirmation ended at ${page.url()}`);
	await page.locator('#reset-password').waitFor();
	return { email, page };
}

const sessionUsable = async (page) =>
	(await page.evaluate(async () => (await fetch('/api/wg/mine')).status)) === 200;

let cases = 0;
// Types the password into the form and submits; "rejected" means the form stopped it itself.
async function choose(account, label, expected, password) {
	cases += 1;
	const { page, email } = account;
	const server = gotrue(password);
	await page.locator('#reset-password').fill(password);
	await page.locator('#reset-password-confirmation').fill(password);
	const sent = page
		.waitForRequest((r) => r.url().endsWith('/api/auth/password'), { timeout: 10_000 })
		.catch(() => null);
	await page.locator('form button[type="submit"]').click();
	const requestSent = await sent;
	const form = requestSent ? 'accepted' : 'rejected';
	if (!requestSent && !(await page.locator('#reset-password-error').isVisible()))
		fail(`${label}: the form neither sent the password nor showed an error`);
	if (form !== server) fail(`${label}: the reset form ${form} it, GoTrue ${server} it`);
	if (form !== expected) fail(`${label}: expected ${expected}, form and GoTrue both ${form} it`);
	if (form === 'rejected') {
		if (!(await sessionUsable(page)))
			fail(`${label}: session no longer usable after the rejection`);
	} else {
		const answer = await (await requestSent.response())?.json();
		if (answer?.ok !== true)
			fail(`${label}: /api/auth/password answered ${JSON.stringify(answer)}`);
		await page.waitForURL((url) => !url.pathname.startsWith('/auth/reset'));
		// A fresh context: the new password alone has to open a session.
		const fresh = await request.newContext({ baseURL: APP, extraHTTPHeaders: { origin: APP } });
		const signIn = await (
			await fresh.post('/api/auth/sign-in', { data: { email, password } })
		).json();
		if (signIn.sessionEstablished !== true)
			fail(`${label}: sign-in with the new password: ${JSON.stringify(signIn)}`);
		if ((await fresh.get('/api/wg/mine')).status() !== 200)
			fail(`${label}: no session after signing in`);
		await fresh.dispose();
	}
	console.log(`ok   ${form}  ${label}`);
}

const first = await confirmedAccount();
await choose(first, '7 ASCII characters', 'rejected', hex(4).slice(0, 7));
await choose(first, '4 emoji (8 UTF-16 units)', 'rejected', emoji(4));
await choose(
	first,
	'7 code points with emoji (10 UTF-16 units)',
	'rejected',
	`${hex(2)}${emoji(3)}`,
);
await choose(
	first,
	'8 code points with emoji, the retry after the rejections',
	'accepted',
	`${hex(3)}${emoji(2)}`,
);
const second = await confirmedAccount();
await choose(second, '8 emoji, all surrogate pairs (16 UTF-16 units)', 'accepted', emoji(8));

await browser.close();
if (cases !== 5) fail(`only ${cases} of 5 password cases ran`);
console.log('OK: the reset form and GoTrue agree on every new password');
