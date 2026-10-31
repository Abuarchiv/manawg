import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const wgId = '22222222-2222-4222-8222-222222222222';

interface Row {
	id: string;
	wgId: string;
	createdAt: Date;
	boughtAt: Date | null;
}
type Predicate = [string, ...unknown[]];

const state = { rows: [] as Row[], isAdmin: true, deletes: 0 };
let rateLimit: Record<string, unknown> = { success: true };

const shoppingItems = {
	wgId: 'wgId',
	boughtAt: 'boughtAt',
	createdAt: 'createdAt',
};

const matches = (row: Row, predicate: Predicate): boolean => {
	const [op, ...args] = predicate;
	const column = args[0] as keyof Row;
	if (op === 'and') return args.every((part) => matches(row, part as Predicate));
	if (op === 'eq') return row[column] === args[1];
	if (op === 'isNull') return row[column] === null;
	if (op === 'isNotNull') return row[column] !== null;
	throw new Error(`unsupported predicate ${op}`);
};
// Postgres default: NULL sorts as the largest value (last in ASC, first in DESC).
const compare = (orders: [string, 'createdAt' | 'boughtAt'][]) => (a: Row, b: Row) => {
	for (const [direction, column] of orders) {
		const left = a[column]?.getTime() ?? Number.POSITIVE_INFINITY;
		const right = b[column]?.getTime() ?? Number.POSITIVE_INFINITY;
		if (left === right) continue;
		return direction === 'asc' ? left - right : right - left;
	}
	return 0;
};
const db = {
	select: () => ({
		from: (table: unknown) => {
			assert.equal(table, shoppingItems);
			return {
				where: (predicate: Predicate) => ({
					orderBy: (...orders: [string, 'createdAt' | 'boughtAt'][]) => ({
						limit: async (limit: number) =>
							state.rows
								.filter((row) => matches(row, predicate))
								.sort(compare(orders))
								.slice(0, limit),
					}),
				}),
			};
		},
	}),
	delete: () => {
		state.deletes++;
		return { where: () => ({ returning: async () => [{ id: 'bought-1', name: 'Milk' }] }) };
	},
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', {
	namedExports: { db, idempotencyResponses: {}, shoppingItems, wgMembers: {} },
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort: class TransactionAbort extends Error {},
		withTransaction: async () => assert.fail('GET opens no transaction'),
	},
});
mock.module('@/core/guards/admin', { namedExports: { isWgAdmin: async () => state.isAdmin } });
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({ ok: true, wg: { id: wgId }, member: { memberId: 'm' } }),
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: {
		claimResponseSlot: async () => null,
		getCachedResponse: async () => null,
		readIdempotencyKey: () => null,
		setReplayWarning: async () => false,
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: { dispatchNotificationSafely: async () => ({ warning: null }) },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => rateLimit, wgWriteLimiter: {} },
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...parts: unknown[]) => ['and', ...parts],
		asc: (column: unknown) => ['asc', column],
		desc: (column: unknown) => ['desc', column],
		eq: (...parts: unknown[]) => ['eq', ...parts],
		isNotNull: (column: unknown) => ['isNotNull', column],
		isNull: (column: unknown) => ['isNull', column],
		sql: () => ({}),
	},
});

const { DELETE, GET, POST } = await import('./route');

test('GET keeps every open item even when the bought history exceeds the list limit', async () => {
	const base = Date.parse('2026-01-01T00:00:00.000Z');
	const rows: Row[] = [];
	for (let index = 0; index < 1500; index++) {
		rows.push({
			id: `bought-${index}`,
			wgId,
			createdAt: new Date(base + index * 1000),
			boughtAt: new Date(base + index * 1000 + 500),
		});
	}
	for (let index = 0; index < 3; index++) {
		rows.push({
			id: `open-${index}`,
			wgId,
			createdAt: new Date(base + index * 1000),
			boughtAt: null,
		});
	}
	rows.push({ id: 'other-wg', wgId: 'other', createdAt: new Date(base), boughtAt: null });

	state.rows = rows;
	const response = await GET(
		new Request('https://example.invalid/api/wg/MTE8PZAT/shopping') as never,
		{
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		} as never,
	);
	assert.equal(response.status, 200);
	const { items } = (await response.json()) as { items: { id: string }[] };
	const ids = items.map((item) => item.id);

	assert.deepEqual(ids.slice(0, 3), ['open-0', 'open-1', 'open-2']);
	assert.equal(ids.includes('other-wg'), false);
	const bought = ids.slice(3);
	assert.equal(bought.length, 1000);
	// Bought history is capped from the newest purchase backwards.
	assert.equal(bought[0], 'bought-1499');
	assert.equal(bought.at(-1), 'bought-500');
});

const create = () =>
	POST(
		new Request('https://example.invalid/api/wg/MTE8PZAT/shopping', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Milk' }),
		}) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
	);

test('POST answers 503 with Retry-After when the rate limiter is down', async () => {
	rateLimit = {
		success: false,
		remaining: 0,
		reset: Date.now() + 60_000,
		limiterUnavailable: true,
	};
	const response = await create();
	assert.equal(response.status, 503);
	assert.equal(((await response.json()) as { error: string }).error, 'rate_limiter_unavailable');
	assert.ok(Number(response.headers.get('Retry-After')) >= 1);
});

test('POST answers 429 when the member exceeds the limit', async () => {
	rateLimit = { success: false, remaining: 0, reset: Date.now() + 60_000 };
	const response = await create();
	assert.equal(response.status, 429);
	assert.equal(((await response.json()) as { error: string }).error, 'too_many_requests');
});

const clearBought = () =>
	DELETE(
		new Request('https://example.invalid/api/wg/MTE8PZAT/shopping', { method: 'DELETE' }) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
	);

test('a non-admin cannot clear bought items', async () => {
	rateLimit = { success: true };
	state.isAdmin = false;
	state.deletes = 0;
	const response = await clearBought();
	assert.equal(response.status, 403);
	assert.equal(((await response.json()) as { error: string }).error, 'not_admin');
	assert.equal(state.deletes, 0);
});

test('an admin clears the bought items', async () => {
	rateLimit = { success: true };
	state.isAdmin = true;
	state.deletes = 0;
	const response = await clearBought();
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { deleted: 1 });
	assert.equal(state.deletes, 1);
});
