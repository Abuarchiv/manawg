// Load pass for data.mjs: hundreds of expenses, chat messages and shopping items, then API
// timings and page loads on the phone viewport.
import { call, expect } from './modules-lib.mjs';

const batched = async (n, size, fn) => {
	let failures = 0;
	for (let i = 0; i < n; i += size) {
		const results = await Promise.all(
			Array.from({ length: Math.min(size, n - i) }, (_, k) => fn(i + k)),
		);
		failures += results.filter((r) => r.status >= 300).length;
	}
	return failures;
};
const timed = async (u, path) => {
	const t0 = performance.now();
	const res = await u.ctx.fetch(path);
	const text = await res.text();
	return { ms: Math.round(performance.now() - t0), bytes: text.length, status: res.status() };
};

export async function run({ A, B, code, annaId, benId, page, consoleErrors }) {
	const api = `/api/wg/${code}`;
	const day = 86_400_000;
	const failed = await batched(400, 20, (i) =>
		call(i % 2 ? A : B, 'POST', `${api}/expenses`, {
			description: `Last ${i}`,
			category: i % 3 ? 'lebensmittel' : 'wohnen',
			amountCents: 100 + (i % 97) * 7,
			paidByMemberId: i % 2 ? annaId : benId,
			occurredAt: new Date(Date.now() - (i % 120) * day).toISOString(),
			splits: [
				{ debtorMemberId: annaId, amountCents: Math.floor((100 + (i % 97) * 7) / 2) },
				{ debtorMemberId: benId, amountCents: Math.ceil((100 + (i % 97) * 7) / 2) },
			],
		}),
	);
	expect(failed === 0, 'Load: 400 expenses created', `${failed} failed`);
	const failedChat = await batched(150, 10, (i) =>
		call(i % 2 ? A : B, 'POST', `${api}/chat/messages`, {
			body: `Nachricht ${i} ${'x'.repeat(i % 80)}`,
		}),
	);
	expect(failedChat === 0, 'Load: 150 chat messages', `${failedChat} failed`);
	const failedShop = await batched(60, 20, (i) =>
		call(A, 'POST', `${api}/shopping`, { name: `Artikel ${i}`, quantity: String(1 + (i % 5)) }),
	);
	expect(failedShop === 0, 'Load: 60 shopping items', `${failedShop} failed`);

	for (const path of [
		'/expenses',
		'/dashboard',
		'/chat/messages',
		'/shopping',
		'/activity',
		'/export',
	]) {
		const t = await timed(A, `${api}${path}`);
		process.stdout.write(`GET ${path}: ${t.ms} ms, ${Math.round(t.bytes / 1024)} kB\n`);
		expect(
			t.status === 200 && t.ms < 2500,
			`Load: GET ${path} ${t.ms} ms, ${Math.round(t.bytes / 1024)} kB`,
			`${t.status} ${t.ms} ms`,
		);
	}
	const dash = await call(A, 'GET', `${api}/dashboard`);
	const exp = await call(A, 'GET', `${api}/expenses`);
	expect(
		exp.body.expenses?.length >= 400,
		'Load: list returns all expenses',
		String(exp.body.expenses?.length),
	);
	const anna = exp.body.expenses.reduce((sum, e) => {
		const paid = e.paidByMemberId === annaId ? e.amountCents : 0;
		const share = e.splits.find((s) => s.debtorMemberId === annaId)?.amountCents ?? 0;
		return sum + paid - share;
	}, 0);
	expect(
		typeof dash.body?.balance?.netCents === 'number'
			? dash.body.balance.netCents === anna
			: JSON.stringify(dash.body).includes(String(anna)),
		`Load: dashboard balance = sum of expenses (${anna})`,
		JSON.stringify(dash.body).slice(0, 300),
	);

	for (const path of [
		'',
		'/expenses',
		'/chat',
		'/shopping',
		'/statement?monat=2026-10',
		'/activity',
	]) {
		consoleErrors.length = 0;
		const t0 = performance.now();
		await page.goto(`/wg/${code}${path}`);
		await page.waitForLoadState('networkidle');
		const ms = Math.round(performance.now() - t0);
		process.stdout.write(`Page ${path || '/'}: ${ms} ms\n`);
		const text = await page.locator('body').innerText();
		const errorText = text.match(/[^\n]*(fehlgeschlagen|konnte nicht|nicht geladen)[^\n]*/i)?.[0];
		expect(
			ms < 8000 && consoleErrors.length === 0 && !errorText,
			`Load: page ${path || '/'} in ${ms} ms`,
			`${ms} ms ${consoleErrors.join(' | ')} ${errorText ?? ''}`,
		);
	}
	await page.goto(`/wg/${code}/expenses`);
	await page.waitForLoadState('networkidle');
	// The list renders in pages; "Mehr anzeigen" must reach the end without errors.
	const more = page.getByRole('button', { name: /^Mehr anzeigen/ });
	for (let i = 0; i < 20 && (await more.count()); i++) await more.click();
	const rows = await page.getByRole('button', { name: /^Details öffnen:/ }).count();
	expect(rows >= 400, `Load: expenses page shows ${rows} rows`, String(rows));
	const chatRes = await call(B, 'GET', `${api}/chat/messages`);
	const n = chatRes.body.messages?.length ?? 0;
	const oldest = chatRes.body.messages?.[0];
	const older = oldest
		? await call(
				B,
				'GET',
				`${api}/chat/messages?before=${encodeURIComponent(oldest.createdAt)}&beforeId=${oldest.id}`,
			)
		: null;
	expect(
		n > 0 && n < 150 && (older?.body.messages?.length ?? 0) > 0,
		`Load: chat paginated (${n} first, ${older?.body.messages?.length ?? 0} older)`,
		JSON.stringify(chatRes.body).slice(0, 200),
	);
}
