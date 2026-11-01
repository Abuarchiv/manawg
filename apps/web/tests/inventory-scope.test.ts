import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import pg from 'pg';

// Inventory SQL that mocked route tests cannot see: WG scope of list and delete, the low-stock
// boundary, and what a no-op consume, a parallel consume or a create above the threshold leaves
// behind. Opt-in: TEST_DATABASE_URL must name a disposable loopback database with all migrations
// applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
	process.env.DATABASE_URL = url;
	process.env.POSTGRES_URL = url;
}

const code = 'MTE8PZAT';
const wg = { id: '' };
const caller = { memberId: '', name: 'Caller' };
mock.module('@/core/guards/require-wg-member', {
	namedExports: { requireWgMember: async () => ({ ok: true, wg, member: caller }) },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 3 });
const ids = { wgA: '', wgB: '', member: '', otherMember: '' };

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
	(await pool.query(sql, params)).rows as T[];

async function insertItem(
	wgId: string,
	name: string,
	quantity: number,
	threshold: number,
): Promise<string> {
	const [row] = await rows<{ id: string }>(
		`INSERT INTO public.wg_inventory_items (wg_id, name, quantity, threshold)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		[wgId, name, quantity, threshold],
	);
	return row?.id ?? '';
}

function ctx(extra: Record<string, string> = {}) {
	return { params: Promise.resolve({ code, ...extra }) } as never;
}

function json(path: string, method: string, body?: unknown): never {
	return new NextRequest(`https://example.invalid/api/wg/${code}${path}`, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	}) as never;
}

before(async () => {
	if (skip) return;
	const suffix = randomUUID().replaceAll('-', '');
	for (const key of ['wgA', 'wgB'] as const) {
		const [wgRow] = await rows<{ id: string }>(
			'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
			[`${key === 'wgA' ? 'A' : 'B'}${suffix.slice(0, 7)}`, `Inventory ${key} ${suffix}`],
		);
		ids[key] = wgRow?.id ?? '';
	}
	const member = async (wgId: string, name: string) =>
		(
			await rows<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
				[wgId, `${name} ${suffix}`],
			)
		)[0]?.id ?? '';
	ids.member = await member(ids.wgA, 'Member');
	ids.otherMember = await member(ids.wgB, 'Other');
	wg.id = ids.wgA;
	caller.memberId = ids.member;
});

after(async () => {
	if (skip) return;
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[ids.wgA, ids.wgB]]);
	await pool.end();
});

test('lowStock lists items at or below the threshold of the caller WG only', { skip }, async () => {
	const { GET } = await import('../src/app/api/wg/[code]/inventory/route.ts');
	const stamp = randomUUID().slice(0, 8);
	const atThreshold = await insertItem(ids.wgA, `at ${stamp}`, 2, 2);
	const below = await insertItem(ids.wgA, `below ${stamp}`, 0, 2);
	const above = await insertItem(ids.wgA, `above ${stamp}`, 3, 2);
	const foreignLow = await insertItem(ids.wgB, `foreign low ${stamp}`, 0, 5);

	const response = await GET(json('/inventory?lowStock=true', 'GET'), ctx());
	assert.equal(response.status, 200);
	const listed = ((await response.json()) as { items: { id: string }[] }).items.map((i) => i.id);
	assert.ok(listed.includes(atThreshold), 'an item exactly at its threshold is low');
	assert.ok(listed.includes(below));
	assert.ok(!listed.includes(above));
	assert.ok(!listed.includes(foreignLow), 'another WG never shows up');
});

test('deleting an inventory item cannot reach another WG', { skip }, async () => {
	const { DELETE } = await import('../src/app/api/wg/[code]/inventory/[id]/route.ts');
	const stamp = randomUUID().slice(0, 8);
	const own = await insertItem(ids.wgA, `own ${stamp}`, 1, 1);
	const foreign = await insertItem(ids.wgB, `foreign ${stamp}`, 1, 1);
	const exists = async (id: string) =>
		(await rows('SELECT 1 FROM public.wg_inventory_items WHERE id = $1', [id])).length === 1;

	assert.equal(
		(await DELETE(json(`/inventory/${foreign}`, 'DELETE'), ctx({ id: foreign }))).status,
		404,
	);
	assert.ok(await exists(foreign));
	assert.equal((await DELETE(json(`/inventory/${own}`, 'DELETE'), ctx({ id: own }))).status, 200);
	assert.ok(!(await exists(own)));
});

test('a new item above its threshold does not land on the shopping list', { skip }, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/inventory/route.ts');
	const stamp = randomUUID().slice(0, 8);
	const shoppingNames = async () =>
		(
			await rows<{ name: string }>('SELECT name FROM public.shopping_items WHERE wg_id = $1', [
				ids.wgA,
			])
		).map((r) => r.name);

	const stocked = await POST(
		json('/inventory', 'POST', { name: `Stocked ${stamp}`, quantity: 5, threshold: 1 }),
		ctx(),
	);
	assert.equal(stocked.status, 200);
	assert.ok(!(await shoppingNames()).includes(`Stocked ${stamp}`));

	const empty = await POST(
		json('/inventory', 'POST', { name: `Empty ${stamp}`, quantity: 0, threshold: 1 }),
		ctx(),
	);
	assert.equal(empty.status, 200);
	assert.ok((await shoppingNames()).includes(`Empty ${stamp}`));
});

test('consuming from an empty item changes nothing and writes no log row', { skip }, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/inventory/[id]/consume/route.ts');
	const stamp = randomUUID().slice(0, 8);
	const item = await insertItem(ids.wgA, `empty ${stamp}`, 0, 1);
	const response = await POST(
		json(`/inventory/${item}/consume`, 'POST', { delta: -1 }),
		ctx({ id: item }),
	);
	assert.equal(response.status, 200);
	const body = (await response.json()) as { clamped: boolean };
	assert.equal(body.clamped, true);
	const [stored] = await rows<{ quantity: string; last_decremented_at: Date | null }>(
		'SELECT quantity, last_decremented_at FROM public.wg_inventory_items WHERE id = $1',
		[item],
	);
	assert.equal(Number(stored?.quantity), 0);
	assert.equal(stored?.last_decremented_at, null);
	assert.equal(
		(await rows('SELECT 1 FROM public.wg_inventory_log WHERE item_id = $1', [item])).length,
		0,
	);
});

test('two simultaneous consumes both apply instead of one failing with 409', { skip }, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/inventory/[id]/consume/route.ts');
	const stamp = randomUUID().slice(0, 8);
	const item = await insertItem(ids.wgA, `race ${stamp}`, 5, 1);
	const tap = () =>
		POST(json(`/inventory/${item}/consume`, 'POST', { delta: -1 }), ctx({ id: item }));
	const statuses = (await Promise.all([tap(), tap(), tap()])).map((r) => r.status);
	assert.deepEqual(statuses, [200, 200, 200]);
	const [stored] = await rows<{ quantity: string }>(
		'SELECT quantity FROM public.wg_inventory_items WHERE id = $1',
		[item],
	);
	assert.equal(Number(stored?.quantity), 2);
});

test('a consume delta must be a whole number from -100 to -1', { skip }, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/inventory/[id]/consume/route.ts');
	const item = await insertItem(ids.wgA, `bounds ${randomUUID().slice(0, 8)}`, 50, 1);
	for (const delta of [0, 1, -101, -1.5]) {
		const response = await POST(
			json(`/inventory/${item}/consume`, 'POST', { delta }),
			ctx({ id: item }),
		);
		assert.equal(response.status, 400, `delta ${delta}`);
	}
	assert.equal(
		(await POST(json(`/inventory/${item}/consume`, 'POST', { delta: -100 }), ctx({ id: item })))
			.status,
		200,
	);
});
