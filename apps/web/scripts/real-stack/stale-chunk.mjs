// A tab from before a deploy: its next lazy chunk is gone (404). The app must recover with one
// reload instead of parking the member on "Etwas ist schiefgelaufen".
import { chromium, devices } from '@playwright/test';
import { BASE, call, expect, finish, user } from './modules-lib.mjs';

const A = await user('Chunk');
const w = await call(A, 'POST', '/api/wg', { name: 'Chunkwohnung', creatorName: 'Chunk' });
const code = w.body.wg?.shareCode;
expect(!!code, 'WG created');

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
await ctx.addCookies((await A.ctx.storageState()).cookies);
const p = await ctx.newPage();

let blocked = 0;
let loads = 0;
let armed = false;
const chunk = /\/_next\/static\/chunks\/.*einkauf\/page-[^/]*\.js(\?.*)?$/;
await p.route(chunk, (route) => {
	blocked += 1;
	return route.fulfill({ status: 404, body: '' });
});
p.on('load', () => {
	if (!armed) return;
	loads += 1;
	// The deploy is "done" by the time the tab reloads: serve the chunk again.
	p.unroute(chunk).catch(() => undefined);
});
// Route handlers run before the prefetch of the visible segment links, so the page chunk is
// never cached: like a tab whose chunk the next deploy removed.
await p.goto(`/wg/${code}/chores`);
await p.waitForLoadState('networkidle');
armed = true;
await p
	.getByText(/^Einkäufe/)
	.first()
	.click();
await p.getByPlaceholder(/Reis/).waitFor({ timeout: 20_000 });
await p.waitForLoadState('load');
const marker = await p.evaluate(() => window.sessionStorage.getItem('manawg:stale-chunk-reload'));
expect(
	marker === p.url(),
	'reload came from the error boundary (sessionStorage marker)',
	String(marker),
);
expect(blocked > 0, 'old chunk was answered with 404', String(blocked));
expect(loads === 1, 'exactly one reload', String(loads));
expect(/\/shopping/.test(p.url()), 'shopping visible after reload', p.url());
const stuck = await p.getByText('Etwas ist schiefgelaufen').count();
expect(stuck === 0, 'no error page left standing');
await browser.close();
finish();
