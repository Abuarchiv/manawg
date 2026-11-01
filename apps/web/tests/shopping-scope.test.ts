import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import pg from 'pg';

// The shopping clear, delete and check-off routes against a real PostgreSQL: their WG scope and
// bought-only filter live in SQL, which the mocked route tests cannot see. Opt-in:
// TEST_DATABASE_URL must name a disposable loopback database with all migrations applied
// (`pnpm test:db`).
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

const caller = { memberId: '', name: 'Caller' };
const wg = { id: '' };
mock.module('@/core/guards/require-wg-member', {
	namedExports: { requireWgMember: async () => ({ ok: true, wg, member: caller }) },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 2 });
const ids = { wgA: '', wgB: '', admin: '', member: '', otherMember: '' };

async function one<T>(sql: string, params: unknown[]): Promise<T> {
	return (await pool.query(sql, params)).rows[0] as T;
}

async function insertItem(wgId: string, memberId: string, name: string, bought: boolean) {
	const row = await one<{ id: string }>(
		`INSERT INTO public.shopping_items (wg_id, added_by_member_id, name, bought_at, bought_by_member_id)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		[wgId, memberId, name, bought ? new Date() : null, bought ? memberId : null],
	);
	return row.id;
}

before(async () => {
	if (skip) return;
	const suffix = randomUUID().replaceAll('-', '');
	for (const key of ['wgA', 'wgB'] as const) {
		ids[key] = (
			await one<{ id: string }>(
				'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
				[`${key === 'wgA' ? 'A' : 'B'}${suffix.slice(0, 7)}`, `Scope ${key} ${suffix}`],
			)
		).id;
	}
	const member = async (wgId: string, name: string, role: string) =>
		(
			await one<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name, role) VALUES ($1, $2, $3) RETURNING id',
				[wgId, `${name} ${suffix}`, role],
			)
		).id;
	ids.admin = await member(ids.wgA, 'Admin', 'admin');
	ids.member = await member(ids.wgA, 'Member', 'member');
	ids.otherMember = await member(ids.wgB, 'Other', 'admin');
	wg.id = ids.wgA;
});

after(async () => {
	if (skip) return;
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[ids.wgA, ids.wgB]]);
	await pool.end();
});

function request(path: string, method: string, body?: unknown): Request {
	return new Request(`https://example.invalid${path}`, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

test('clearing the bought items removes only bought rows of the caller WG', { skip }, async () => {
	const { DELETE } = await import('../src/app/api/wg/[code]/shopping/route.ts');
	const stamp = randomUUID().slice(0, 8);
	const mine = {
		bought: await insertItem(ids.wgA, ids.member, `bought ${stamp}`, true),
		open: await insertItem(ids.wgA, ids.member, `open ${stamp}`, false),
	};
	const theirs = {
		bought: await insertItem(ids.wgB, ids.otherMember, `foreign bought ${stamp}`, true),
		open: await insertItem(ids.wgB, ids.otherMember, `foreign open ${stamp}`, false),
	};
	const left = async () =>
		(
			await pool.query<{ id: string }>('SELECT id FROM public.shopping_items WHERE id = ANY($1)', [
				[...Object.values(mine), ...Object.values(theirs)],
			])
		).rows.map((row) => row.id);
	const call = () =>
		DELETE(
			request('/api/wg/MTE8PZAT/shopping', 'DELETE') as never,
			{
				params: Promise.resolve({ code: 'MTE8PZAT' }),
			} as never,
		);

	caller.memberId = ids.member;
	assert.equal((await call()).status, 403);
	assert.equal((await left()).length, 4);

	caller.memberId = ids.admin;
	const response = await call();
	assert.equal(response.status, 200);
	assert.ok(((await response.json()) as { deleted: number }).deleted >= 1);
	assert.deepEqual((await left()).sort(), [mine.open, theirs.bought, theirs.open].sort());
});

test('a shopping item is deleted only by its adder or the admin, and only inside the WG', {
	skip,
}, async () => {
	const { DELETE } = await import('../src/app/api/wg/[code]/shopping/[id]/route.ts');
	const stamp = randomUUID().slice(0, 8);
	const adminItem = await insertItem(ids.wgA, ids.admin, `admin item ${stamp}`, false);
	const memberItem = await insertItem(ids.wgA, ids.member, `member item ${stamp}`, false);
	const foreignItem = await insertItem(ids.wgB, ids.otherMember, `foreign item ${stamp}`, false);
	const call = (id: string) =>
		DELETE(
			request(`/api/wg/MTE8PZAT/shopping/${id}`, 'DELETE') as never,
			{
				params: Promise.resolve({ code: 'MTE8PZAT', id }),
			} as never,
		);
	const exists = async (id: string) =>
		(await pool.query('SELECT 1 FROM public.shopping_items WHERE id = $1', [id])).rowCount === 1;

	caller.memberId = ids.member;
	assert.equal((await call(adminItem)).status, 403);
	assert.ok(await exists(adminItem));
	assert.equal((await call(foreignItem)).status, 404);
	assert.ok(await exists(foreignItem));
	assert.equal((await call(memberItem)).status, 200);
	assert.ok(!(await exists(memberItem)));

	caller.memberId = ids.admin;
	assert.equal((await call(foreignItem)).status, 404);
	assert.ok(await exists(foreignItem));
	assert.equal((await call(adminItem)).status, 200);
});

test('checking an item off changes only an item of the caller WG and records the caller as buyer', {
	skip,
}, async () => {
	const { PATCH } = await import('../src/app/api/wg/[code]/shopping/[id]/route.ts');
	const stamp = randomUUID().slice(0, 8);
	const own = await insertItem(ids.wgA, ids.admin, `own toggle ${stamp}`, false);
	const foreign = await insertItem(ids.wgB, ids.otherMember, `foreign toggle ${stamp}`, false);
	const call = async (id: string) => {
		const { updated_at } = await one<{ updated_at: Date }>(
			'SELECT updated_at FROM public.shopping_items WHERE id = $1',
			[id],
		);
		const req = new Request(`https://example.invalid/api/wg/MTE8PZAT/shopping/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
			body: JSON.stringify({
				bought: true,
				expectedUpdatedAt: updated_at.toISOString(),
				expectedBoughtAt: null,
			}),
		});
		return PATCH(req as never, { params: Promise.resolve({ code: 'MTE8PZAT', id }) } as never);
	};
	const state = async (id: string) =>
		one<{ bought_at: Date | null; bought_by_member_id: string | null }>(
			'SELECT bought_at, bought_by_member_id FROM public.shopping_items WHERE id = $1',
			[id],
		);

	caller.memberId = ids.member;
	assert.equal((await call(foreign)).status, 404);
	assert.equal((await state(foreign)).bought_at, null);
	assert.equal((await call(own)).status, 200);
	const after = await state(own);
	assert.ok(after.bought_at);
	assert.equal(after.bought_by_member_id, ids.member);
});
