// Web Push end to end: a member turns push on in real Chrome (FCM), the server sends the test
// notification and a WG event, and the service worker shows both. Needs VAPID keys in the stack
// and Google Chrome installed.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { BASE, call, expect, finish, setup } from './modules-lib.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const { A, B, code } = await setup();

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'push-')), {
	channel: 'chrome',
	headless: process.env.HEADED !== '1',
	baseURL: BASE,
	viewport: { width: 390, height: 844 },
});
await ctx.grantPermissions(['notifications'], { origin: BASE });
await ctx.addCookies((await A.ctx.storageState()).cookies);
const p = ctx.pages()[0] ?? (await ctx.newPage());
const reqLog = [];
p.on('request', (r) => {
	if (r.url().includes('/notifications'))
		reqLog.push(`${Date.now() % 100000} ${r.method()} ${(r.postData() ?? '').slice(0, 60)}`);
});
p.on('response', (r) => {
	if (r.url().includes('/notifications')) reqLog.push(`${Date.now() % 100000} <- ${r.status()}`);
});
await p.goto(`/wg/${code}/settings`);
await p.getByRole('tab', { name: 'Benachrichtigungen' }).click();
const toggle = p.getByRole('switch', { name: /Web Push/ });
await toggle.and(p.locator(':enabled')).waitFor();
await p.waitForLoadState('networkidle');
await toggle.click();
await p
	.getByRole('button', { name: 'Testbenachrichtigung senden' })
	.waitFor({ timeout: 120_000 })
	.catch(async () => {
		const text = (await p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 600);
		expect(false, 'push turns on', text);
		finish();
		process.exit(1);
	});
const subscribed = await p.evaluate(async () => {
	const reg = await navigator.serviceWorker.ready;
	return (await reg.pushManager.getSubscription())?.endpoint ?? null;
});
expect(!!subscribed, 'browser holds a push subscription', String(subscribed).slice(0, 60));

const shown = async (title) => {
	for (let i = 0; i < 120; i++) {
		const titles = await p.evaluate(async () =>
			(await (await navigator.serviceWorker.ready).getNotifications()).map(
				(n) => `${n.title} | ${n.body} | ${n.data?.url ?? ''}`,
			),
		);
		if (titles.some((t) => title.test(t))) return titles;
		await wait(500);
	}
	return null;
};
const testSent = p.waitForResponse(
	(r) => r.url().endsWith('/notifications') && r.request().method() === 'POST',
);
await p.getByRole('button', { name: 'Testbenachrichtigung senden' }).click();
const testResponse = await testSent;
expect(
	testResponse.status() === 200,
	'server delivered the test to the push service',
	`${testResponse.status()} ${await testResponse.text()}`,
);
const test = await shown(/Test/);
expect(!!test, 'test notification arrives', JSON.stringify(test));

// A WG event from the other member reaches Anna.
const post = await call(B, 'POST', `/api/wg/${code}/announcements`, {
	content: 'Heizung ist kaputt',
	kind: 'info',
});
expect(
	post.status < 300 && post.body.warning === null,
	'pinboard post sent without warning',
	JSON.stringify(post.body).slice(0, 200),
);
const event = await shown(/Heizung/);
expect(!!event, 'pinboard post from Ben arrives as push', JSON.stringify(event));
if (process.env.VERBOSE_PUSH) process.stdout.write(`${reqLog.join('\n')}\n`);
await ctx.close();
finish();
