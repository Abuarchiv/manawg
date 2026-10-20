// Session refresh after the access token expired. Run against a stack whose
// `jwt_expiry` is 60 (scratch supabase/config.toml), otherwise this waits an hour.
import { chromium, devices, request } from '@playwright/test';
import { BASE, call, expect, finish, user } from './modules-lib.mjs';

const JWT_SECONDS = Number(process.env.JWT_EXPIRY ?? 60);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const expireWait = async (label) => {
	process.stdout.write(`… warte ${JWT_SECONDS + 15}s (${label})\n`);
	await wait((JWT_SECONDS + 15) * 1000);
};

const A = await user('Anna');
const w = await call(A, 'POST', '/api/wg', { name: 'Ablaufwohnung', creatorName: 'Anna' });
const code = w.body.wg?.shareCode;
expect(!!code, 'WG erstellt');
const fresh = await call(A, 'GET', '/api/wg/mine');
expect(fresh.status === 200, 'mine vor Ablauf 200', String(fresh.status));

// 1 API read after expiry: refresh token must mint a new session.
await expireWait('API-Lesen');
const r1 = await A.ctx.fetch('/api/wg/mine');
expect(r1.status() === 200, 'mine nach Ablauf 200', String(r1.status()));
expect(
	(r1.headers()['set-cookie'] ?? '').includes('auth-token'),
	'Refresh setzt neue Auth-Cookies',
	(r1.headers()['set-cookie'] ?? '').slice(0, 80),
);
const r2 = await A.ctx.fetch('/api/wg/mine');
expect(r2.status() === 200, 'mine nach Refresh erneut 200', String(r2.status()));

// 2 Write after expiry, plus a burst of parallel reads with the same stale cookies
// (several tabs or a dashboard load firing many fetches at once).
await expireWait('Schreiben + Parallel');
const stale = (await A.ctx.storageState()).cookies;
const parallel = await Promise.all(
	Array.from({ length: 5 }, () =>
		request
			.newContext({
				baseURL: BASE,
				extraHTTPHeaders: { origin: BASE },
				storageState: { cookies: stale, origins: [] },
			})
			.then(async (ctx) => {
				const res = await ctx.fetch(`/api/wg/${code}/shopping`);
				const out = res.status();
				await ctx.dispose();
				return out;
			}),
	),
);
expect(
	parallel.every((s) => s === 200),
	'5 parallele Lese-Tabs mit abgelaufenem Token alle 200',
	parallel.join(','),
);
const post = await call(A, 'POST', `/api/wg/${code}/shopping`, { name: 'Hafer' });
expect(post.status < 300, 'Schreiben nach Ablauf', `${post.status} ${JSON.stringify(post.body)}`);

// 3 Browser: page open, token expires, client-side navigation and fetches keep working.
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
await ctx.addCookies((await A.ctx.storageState()).cookies);
const p = await ctx.newPage();
const bad = [];
p.on('response', (r) => {
	if (r.status() >= 400 && !r.url().includes('/api/auth/')) bad.push(`${r.status()} ${r.url()}`);
});
const RS = process.env.SHOTS_DIR ?? '.';
const dump = async (label) => {
	process.stdout.write(`url=${p.url()}\n`);
	await p.screenshot({ path: `${RS}/session-${label}.png`, fullPage: true }).catch(() => {});
};
process.on('uncaughtException', (e) => {
	process.stdout.write(`CRASH ${e.message.split('\n')[0]}\n`);
	dump('crash').finally(() => {
		finish();
		process.exit(1);
	});
});
await p.goto(`/wg/${code}`);
await p.waitForLoadState('networkidle');
await expireWait('Browser');
await dump('vor-klick');
await p.locator('nav').getByText('Haushalt').click();
await p.waitForLoadState('networkidle');
expect(p.url().includes('/putzen'), 'Tabwechsel ohne Rauswurf', p.url());
await p
	.getByText(/^Einkäufe/)
	.first()
	.click();
await p.waitForURL(/\/einkauf/);
await p.waitForLoadState('networkidle');
await p.getByPlaceholder(/Reis/).fill('Nudeln');
await p.keyboard.press('Enter');
await p.getByText('Nudeln').first().waitFor({ timeout: 10_000 });
expect(true, 'Einkauf nach Ablauf im Browser hinzugefügt');
await p.reload();
await p.waitForLoadState('networkidle');
expect(!/\/(neu|registrieren|anmelden)/.test(p.url()), 'Reload bleibt angemeldet', p.url());
expect(bad.length === 0, 'keine 4xx/5xx im Browser', bad.join(' | '));
await browser.close();
finish();
