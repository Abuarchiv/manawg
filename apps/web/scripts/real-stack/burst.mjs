// Rate limits as in production (needs UPSTASH_* pointing at a Redis REST server and VERCEL_ENV
// unset from development): a member types a long shopping list quickly and ticks it off.
import { chromium, devices } from '@playwright/test';
import { BASE, call, expect, finish, user } from './modules-lib.mjs';

const N = Number(process.env.ITEMS ?? 36);
const A = await user('Burst');
const w = await call(A, 'POST', '/api/wg', { name: 'Burstwohnung', creatorName: 'Burst' });
const code = w.body.wg?.shareCode;
expect(!!code, 'WG erstellt');
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
await ctx.addCookies((await A.ctx.storageState()).cookies);
const p = await ctx.newPage();
const statuses = [];
p.on('response', (r) => {
	if (r.url().includes('/api/')) statuses.push(`${r.request().method()} ${r.status()}`);
});
await p.goto(`/wg/${code}/shopping`);
await p.waitForLoadState('networkidle');
const t0 = Date.now();
for (let i = 1; i <= N; i += 1) {
	await p.getByPlaceholder(/Reis/).fill(`Artikel ${i}`);
	await p.keyboard.press('Enter');
	await p.waitForTimeout(150);
}
await p.waitForLoadState('networkidle');
const added = await p.getByRole('checkbox', { name: /Artikel \d+ erledigen/ }).count();
const limited = statuses.filter((s) => s.endsWith(' 429')).length;
const perKind = [...new Set(statuses)].map((k) => `${k}×${statuses.filter((s) => s === k).length}`);
process.stdout.write(`Anfragen: ${perKind.join(', ')}\n`);
process.stdout.write(
	`${N} Einträge in ${Math.round((Date.now() - t0) / 1000)} s, sichtbar ${added}, 429: ${limited}\n`,
);
expect(limited === 0, `${N} Einträge in einer Minute ohne 429`, `429=${limited}`);
expect(added === N, 'alle Einträge sichtbar', `${added}/${N}`);
const text = await p.locator('main').innerText();
process.stdout.write(
	`Hinweis: ${(text.match(/[^\n]*(viele|später|Limit|Warte)[^\n]*/i) ?? [''])[0]}\n`,
);
await p.screenshot({ path: `${process.env.SHOTS_DIR ?? '.'}/burst.png`, fullPage: true });
await browser.close();
finish();
