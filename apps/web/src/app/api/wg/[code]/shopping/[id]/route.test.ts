import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { DrizzleQueryError } from 'drizzle-orm';
import { mockDb } from '../../../../../../../tests/support/db-mock';
import {
	type SqlNode,
	isSqlNode,
	mockDrizzle,
	rowMatches,
} from '../../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../tests/support/route-harness';

// The route and the real admin guard run against one in-memory shopping item; its compare-and-set
// predicates (millisecond-truncated timestamps) are evaluated like Postgres would.

const itemId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const otherMemberId = '55555555-5555-4555-8555-555555555555';
// Before the item's last update, so `greatest(clock_timestamp(), updated_at + 1ms)` bumps by 1ms.
const NOW = new Date('2026-09-27T10:00:00.000Z');

const shoppingItems = {
	id: 'id',
	wgId: 'wgId',
	updatedAt: 'updatedAt',
	boughtAt: 'boughtAt',
	addedByMemberId: 'addedByMemberId',
	name: 'name',
};
const wgMembers = { id: 'id', wgId: 'wgId', role: 'role', deactivatedAt: 'deactivatedAt' };

interface Item extends Record<string, unknown> {
	id: string;
	wgId: string;
	updatedAt: string | Date;
	boughtAt: Date | null;
	boughtByMemberId: string | null;
	addedByMemberId: string;
	name: string;
}

function freshItem(): Item {
	return {
		id: itemId,
		wgId,
		updatedAt: '2026-09-27T10:00:00.123456Z',
		boughtAt: null,
		boughtByMemberId: null,
		addedByMemberId: memberId,
		name: 'Milch',
	};
}

type Returning = (() => Promise<unknown[]>) | null;

const state = {
	adminMemberId: null as string | null,
	audits: 0,
	deleted: 0,
	notices: 0,
	update: null as Record<string, unknown> | null,
	current: freshItem() as Item | null,
	patches: 0,
	returning: null as Returning,
	transactionAborted: false,
	replayCache: new Map<string, unknown>(),
};

function given(returning: Returning = null): Item {
	const item = freshItem();
	Object.assign(state, {
		adminMemberId: null,
		audits: 0,
		deleted: 0,
		notices: 0,
		update: null,
		current: item,
		patches: 0,
		returning,
		transactionAborted: false,
		replayCache: new Map(),
	});
	observed.logged = [];
	return item;
}

const ms = (value: unknown) => new Date(value as string | Date).getTime();

/** `date_trunc('milliseconds', column) = value`, the route's timestamp compare-and-set. */
function itemMatches(condition: unknown): boolean {
	if (!state.current) return false;
	return rowMatches(state.current, condition, (row, fragment) => {
		const [column, value] = fragment.args as [string, Date];
		assert.match(fragment.text ?? '', /^date_trunc\('milliseconds', \?\) = \?$/);
		return row[column] !== null && ms(row[column]) === value.getTime();
	});
}

/** Resolves `greatest(clock_timestamp(), updated_at + interval '1 millisecond')`. */
function applied(values: Record<string, unknown>, item: Item): Record<string, unknown> {
	const next = { ...values };
	if (isSqlNode(values.updatedAt)) {
		assert.match((values.updatedAt as SqlNode).text ?? '', /^greatest\(clock_timestamp\(\)/);
		next.updatedAt = new Date(Math.max(Date.now(), ms(item.updatedAt) + 1));
	}
	return next;
}

const db = {
	update(table: unknown) {
		assert.equal(table, shoppingItems);
		return {
			set(values: Record<string, unknown>) {
				state.update = values;
				return {
					where(condition: unknown) {
						state.patches += 1;
						return {
							returning: async () => {
								const item = state.current;
								if (!item || !itemMatches(condition)) return [];
								if (state.returning) {
									try {
										await state.returning();
									} catch (error) {
										state.transactionAborted = true;
										throw error;
									}
								}
								state.current = { ...item, ...applied(values, item) } as Item;
								return [{ ...state.current }];
							},
						};
					},
				};
			},
		};
	},
	select() {
		return {
			from(table: unknown) {
				if (table === wgMembers) {
					return {
						where: () => ({
							limit: async () => (state.adminMemberId ? [{ id: state.adminMemberId }] : []),
						}),
					};
				}
				assert.equal(table, shoppingItems);
				return {
					where: () => ({
						limit: async () =>
							state.current
								? [
										{
											id: state.current.id,
											addedByMemberId: state.current.addedByMemberId,
											name: state.current.name,
										},
									]
								: [],
					}),
				};
			},
		};
	},
	delete(table: unknown) {
		assert.equal(table, shoppingItems);
		return {
			where: () => ({
				returning: async () => {
					if (!state.current) return [];
					state.deleted += 1;
					const { id } = state.current;
					state.current = null;
					return [{ id }];
				},
			}),
		};
	},
};

interface ReplayOutcome {
	response: unknown;
	effect: unknown;
}

mockDrizzle();
const observed = mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: wgId }, member: { memberId, name: 'Alex' } });
mockDb({ db, shoppingItems, wgMembers });
mock.module('@/core/activity-feed', {
	namedExports: {
		postSystemNotice: async () => {
			state.notices += 1;
		},
		postChatSystemMessage: async () => undefined,
		resolveShoppingRequest: async () => undefined,
	},
});
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits += 1;
		},
	},
});
// Replays a stored response per scope and key; an error inside the write rolls it back.
mock.module('@/features/pinnwand/server/announcement-replay', {
	namedExports: {
		withAnnouncementReplay: async (
			req: Request,
			scope: string,
			mutate: (tx: typeof db) => Promise<ReplayOutcome>,
		) => {
			const key = req.headers.get('idempotency-key');
			const cacheKey = `${scope}:${key}`;
			if (state.replayCache.has(cacheKey)) {
				return { response: state.replayCache.get(cacheKey), effect: null, key };
			}
			let result: ReplayOutcome;
			try {
				result = await mutate(db);
			} catch (error) {
				state.transactionAborted = false;
				throw error;
			}
			if (state.transactionAborted) {
				state.transactionAborted = false;
				throw new Error('transaction_aborted');
			}
			if (key) state.replayCache.set(cacheKey, result.response);
			return { ...result, key };
		},
	},
});

const { DELETE, PATCH } = await import('./route');

function patch(
	options: {
		body?: unknown;
		bought?: boolean;
		expectedUpdatedAt?: string;
		expectedBoughtAt?: string | null;
	} = {},
) {
	const {
		bought = false,
		expectedUpdatedAt = new Date(state.current?.updatedAt ?? 0).toISOString(),
		expectedBoughtAt = null,
	} = options;
	return PATCH(
		request(`/api/wg/MTE8PZAT/shopping/${itemId}`, {
			method: 'PATCH',
			headers: { 'idempotency-key': '44444444-4444-4444-8444-444444444444' },
			body: options.body ?? { bought, expectedUpdatedAt, expectedBoughtAt },
		}),
		routeCtx({ id: itemId }),
	);
}

const remove = () =>
	DELETE(
		request(`/api/wg/MTE8PZAT/shopping/${itemId}`, { method: 'DELETE' }),
		routeCtx({ id: itemId }),
	);

test('reopening an item that conflicts with another open name returns 409', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const postgresError = Object.assign(new Error('duplicate key value violates unique constraint'), {
		code: '23505',
		constraint: 'shopping_items_unique_open_name',
	});
	const duplicateError = new DrizzleQueryError(
		'update shopping_items set bought_at = null',
		[],
		postgresError,
	);
	given(async () => {
		throw duplicateError;
	});

	const response = await patch();

	assert.deepEqual(await response.json(), { error: 'shopping_item_duplicate' });
	assert.equal(response.status, 409);
	assert.deepEqual(state.update, {
		boughtAt: null,
		boughtByMemberId: null,
		updatedAt: state.update?.updatedAt,
	});
	assert.equal(state.audits, 0);
	assert.equal(state.notices, 0);
});

test('other database errors still use the shared 500 handler', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const postgresError = Object.assign(new Error('different constraint'), {
		code: '23505',
		constraint: 'shopping_items_other_unique_key',
	});
	const queryError = new DrizzleQueryError('update shopping_items', [], postgresError);
	given(async () => {
		throw queryError;
	});

	const response = await patch();

	assert.equal(response.status, 500);
	assert.deepEqual(await response.json(), { error: 'server_error' });
	assert.equal(observed.logged[0]?.errors[0], queryError);
});

test('stale shopping state conflicts without mutation or notification', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const item = given();
	item.updatedAt = new Date('2026-09-27T11:00:00.000Z');

	const response = await patch({ bought: true, expectedUpdatedAt: '2026-09-27T10:00:00.000Z' });

	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), { error: 'shopping_item_changed' });
	assert.equal(state.audits, 0);
	assert.equal(state.notices, 0);
	assert.equal(state.current?.boughtAt, null);
});

test('legacy queued shopping update remains a visible conflict', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	given();

	const response = await patch({ body: { bought: true } });

	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), { error: 'shopping_item_changed' });
	assert.equal(state.patches, 0);
	assert.equal(state.audits, 0);
	assert.equal(state.notices, 0);
});

test('retry of a bought PATCH replays after another member reopens the item', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	given();
	const body = {
		bought: true,
		expectedUpdatedAt: '2026-09-27T10:00:00.123Z',
		expectedBoughtAt: null,
	};
	const first = await patch(body);
	assert.equal(first.status, 200);
	assert.equal(ms(state.current?.updatedAt), Date.parse('2026-09-27T10:00:00.124Z'));
	const reopened = state.current as Item;
	reopened.updatedAt = new Date('2026-09-27T11:00:00.000Z');
	reopened.boughtAt = null;
	reopened.boughtByMemberId = null;

	const retry = await patch(body);

	assert.equal(retry.status, 200);
	assert.equal(state.patches, 1);
	assert.equal(state.audits, 1);
	assert.equal(state.notices, 1);
	assert.equal(state.current?.boughtAt, null);
});

test('the member who added a shopping item may delete it', async () => {
	given();

	const response = await remove();

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { deleted: true });
	assert.equal(state.deleted, 1);
	assert.equal(state.audits, 1);
});

test("a WG admin may delete another member's shopping item", async () => {
	const item = given();
	item.addedByMemberId = otherMemberId;
	state.adminMemberId = memberId;

	const response = await remove();

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { deleted: true });
	assert.equal(state.deleted, 1);
	assert.equal(state.audits, 1);
});

test("non-admins cannot delete another member's item", async () => {
	for (const adminMemberId of [otherMemberId, null]) {
		const item = given();
		item.addedByMemberId = otherMemberId;
		state.adminMemberId = adminMemberId;

		const response = await remove();

		assert.equal(response.status, 403);
		assert.deepEqual(await response.json(), { error: 'not_owner', code: 'not_owner' });
		assert.equal(state.deleted, 0);
		assert.equal(state.audits, 0);
	}
});
