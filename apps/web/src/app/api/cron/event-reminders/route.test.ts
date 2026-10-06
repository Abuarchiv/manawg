import assert from 'node:assert/strict';
import { type TestContext, mock, test } from 'node:test';
import { mockDb } from '../../../../../tests/support/db-mock';
import { type SqlNode, isSqlNode, mockDrizzle } from '../../../../../tests/support/drizzle-mock';
import { mockObservability, request } from '../../../../../tests/support/route-harness';

// The route, the reminder window and the dispatch helpers run for real; the database keeps the
// reminder claims in memory and push delivery is scripted per member.

const CRON_SECRET = 'cron-secret';

const wgEvents = {
	id: 'events.id',
	startsAt: 'events.startsAt',
	endsAt: 'events.endsAt',
	allDay: 'events.allDay',
	recurrence: 'events.recurrence',
	wgId: 'events.wgId',
};
const wgMembers = { id: 'members.id', wgId: 'members.wgId', deactivatedAt: 'members.deactivatedAt' };
const wgs = { id: 'wgs.id', name: 'wgs.name', shareCode: 'wgs.shareCode' };
const idempotencyResponses = {
	scope: 'idempotency.scope',
	key: 'idempotency.key',
	expiresAt: 'idempotency.expiresAt',
	responseBody: 'idempotency.responseBody',
};

type FailureMode = 'partial' | 'all' | 'none';
interface Claim {
	scope: string;
	key: string;
	expiresAt: Date;
}

const state = {
	failureMode: 'partial' as FailureMode,
	events: [] as Record<string, unknown>[],
	members: [] as Record<string, unknown>[],
	claims: new Map<string, Claim>(),
	dispatches: [] as { memberId: string; event: string }[],
};

function given(options: { failureMode?: FailureMode; eventEndsAt?: string } = {}): void {
	state.failureMode = options.failureMode ?? 'partial';
	state.events = [
		{
			id: 'event-1',
			title: 'Treffen',
			description: null,
			startsAt: new Date('2026-10-26T10:00:00.000Z'),
			endsAt: new Date(options.eventEndsAt ?? '2026-10-26T11:00:00.000Z'),
			allDay: false,
			location: null,
			recurrence: null,
			wgId: 'wg-1',
			wgName: 'WG',
			shareCode: 'ABCDEFGH',
		},
	];
	state.members = [
		{ id: 'member-A', wgId: 'wg-1', deactivatedAt: null },
		{ id: 'member-B', wgId: 'wg-1', deactivatedAt: null },
	];
	state.claims = new Map();
	state.dispatches = [];
}

/** The value a condition compares `column` with, searched through `and`/`or`. */
function conditionValue(filter: unknown, op: string, column: string): unknown {
	if (!isSqlNode(filter)) return undefined;
	if (filter.op === op && filter.args[0] === column) return filter.args[1];
	for (const child of filter.args) {
		const found = conditionValue(child, op, column);
		if (found !== undefined) return found;
	}
	return undefined;
}

function claimOf(filter: unknown): string {
	const scope = conditionValue(filter, 'eq', idempotencyResponses.scope);
	const key = conditionValue(filter, 'eq', idempotencyResponses.key);
	return `${scope}:${key}`;
}

function selectedRows(table: unknown, filter: unknown) {
	if (table === wgEvents) return state.events;
	if (table === wgMembers) return state.members;
	if (table === idempotencyResponses) {
		const scope = conditionValue(filter, 'eq', idempotencyResponses.scope);
		const keys = (conditionValue(filter, 'inArray', idempotencyResponses.key) ?? []) as string[];
		return [...state.claims.values()]
			.filter((row) => row.scope === scope && row.expiresAt > new Date())
			.filter((row) => keys.includes(row.key))
			.map((row) => ({ key: row.key }));
	}
	throw new Error('unexpected selected table');
}

mockDrizzle();
mockObservability();
mockDb({
	idempotencyResponses,
	wgEvents,
	wgMembers,
	wgs,
	db: {
		select: () => {
			let table: unknown;
			let filter: SqlNode | undefined;
			const query = {
				from(value: unknown) {
					table = value;
					return query;
				},
				innerJoin() {
					return query;
				},
				where(value: SqlNode) {
					filter = value;
					if (table === wgMembers || table === idempotencyResponses) {
						return Promise.resolve(selectedRows(table, filter));
					}
					return query;
				},
				orderBy() {
					return query;
				},
				limit: async () => selectedRows(table, filter),
			};
			return query;
		},
		insert: () => {
			let values: Claim = { scope: '', key: '', expiresAt: new Date(0) };
			const query = {
				values(value: Claim) {
					values = value;
					return query;
				},
				onConflictDoUpdate() {
					return query;
				},
				returning: async () => {
					const key = `${values.scope}:${values.key}`;
					const existing = state.claims.get(key);
					if (existing && existing.expiresAt > new Date()) return [];
					state.claims.set(key, values);
					return [{ key: values.key }];
				},
			};
			return query;
		},
		update: () => {
			let values: Partial<Claim> = {};
			const query = {
				set(value: Partial<Claim>) {
					values = value;
					return query;
				},
				where(filter: unknown) {
					const row = state.claims.get(claimOf(filter));
					if (row) Object.assign(row, values);
					return Promise.resolve();
				},
			};
			return query;
		},
		delete: () => ({
			where(filter: unknown) {
				state.claims.delete(claimOf(filter));
				return Promise.resolve();
			},
		}),
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotification: async (input: { targetMemberIds: string[]; event: string }) => {
			const memberId = input.targetMemberIds[0] as string;
			state.dispatches.push({ memberId, event: input.event });
			if (state.failureMode === 'all') return { sent: 0, failures: ['provider failed'] };
			if (state.failureMode === 'none') return { sent: 0, failures: [] };
			if (memberId === 'member-B' && input.event === 'event.upcoming') {
				return { sent: 1, failures: ['one device failed'] };
			}
			return { sent: 1, failures: [] };
		},
	},
});

const { GET } = await import('./route');

/** Runs the cron at `at`; the claim table outlives a run, as it does in Postgres. */
async function runAt(t: TestContext, at: string) {
	t.mock.timers.setTime(Date.parse(at));
	const previousSecret = process.env.CRON_SECRET;
	process.env.CRON_SECRET = CRON_SECRET;
	try {
		const response = await GET(
			request('/api/cron/event-reminders', { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
		);
		return { status: response.status, body: await response.json() };
	} finally {
		if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
		else process.env.CRON_SECRET = previousSecret;
	}
}

const dispatched = () =>
	state.dispatches.map(({ memberId, event }) => `${memberId}:${event}`).sort();

test('a partial delivery retries only the failed member with today copy', async (t) => {
	t.mock.timers.enable({ apis: ['Date'] });
	given();

	const tomorrow = await runAt(t, '2026-10-25T09:00:00.000Z');
	assert.equal(tomorrow.status, 503);
	assert.deepEqual(tomorrow.body, { ok: false, sent: 1, failed: 1 });

	const today = await runAt(t, '2026-10-26T09:00:00.000Z');
	assert.equal(today.status, 200);
	assert.deepEqual(today.body, { ok: true, sent: 1, failed: 0 });

	const afterToday = await runAt(t, '2026-10-27T09:00:00.000Z');
	assert.equal(afterToday.status, 200);
	assert.equal(afterToday.body.sent, 0);

	assert.deepEqual(
		dispatched(),
		['member-A:event.upcoming', 'member-B:event.today', 'member-B:event.upcoming'].sort(),
	);
});

test('all provider failures are reported with an unavailable response', async (t) => {
	t.mock.timers.enable({ apis: ['Date'] });
	given({ failureMode: 'all' });
	const response = await runAt(t, '2026-10-25T09:00:00.000Z');
	assert.equal(response.status, 503);
	assert.deepEqual(response.body, { ok: false, sent: 0, failed: 2 });
});

test('no applicable push subscriptions are not reported as a provider failure', async (t) => {
	t.mock.timers.enable({ apis: ['Date'] });
	given({ failureMode: 'none' });
	const response = await runAt(t, '2026-10-25T09:00:00.000Z');
	assert.equal(response.status, 200);
	assert.deepEqual(response.body, { ok: true, sent: 0, failed: 0 });
});

test('successful claims cover long occurrences while failed members remain retryable', async (t) => {
	t.mock.timers.enable({ apis: ['Date'] });
	given({ eventEndsAt: '2026-12-01T10:00:00.000Z' });

	const tomorrow = await runAt(t, '2026-10-25T09:00:00.000Z');
	assert.equal(tomorrow.status, 503);
	assert.deepEqual(tomorrow.body, { ok: false, sent: 1, failed: 1 });

	const ongoing = await runAt(t, '2026-11-27T09:00:00.000Z');
	assert.equal(ongoing.status, 200);
	assert.deepEqual(ongoing.body, { ok: true, sent: 1, failed: 0 });

	assert.deepEqual(
		dispatched(),
		['member-A:event.upcoming', 'member-B:event.today', 'member-B:event.upcoming'].sort(),
	);
});
