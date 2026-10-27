import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { withEnv } from '../../../../../tests/support/env';
import { nextBerlinDayStart, startOfBerlinDay } from '../../../../core/utils/berlin-day';

const wgEvents = {
	id: 'events.id',
	startsAt: 'events.startsAt',
	endsAt: 'events.endsAt',
	allDay: 'events.allDay',
	recurrence: 'events.recurrence',
	wgId: 'events.wgId',
};
const wgMembers = {
	id: 'members.id',
	wgId: 'members.wgId',
	deactivatedAt: 'members.deactivatedAt',
};
const wgs = { id: 'wgs.id', name: 'wgs.name', shareCode: 'wgs.shareCode' };
const idempotencyResponses = {
	scope: 'idempotency.scope',
	key: 'idempotency.key',
	expiresAt: 'idempotency.expiresAt',
	responseBody: 'idempotency.responseBody',
};

type Condition = { op: string; column?: unknown; value?: unknown; conditions?: Condition[] };
type Row = Record<string, unknown>;
type Claim = { scope: string; key: string; expiresAt: Date };
type Dispatch = { targetMemberIds: string[]; event: string; payload: { allDay: unknown } };

function condition(op: string, column: unknown, value?: unknown): Condition {
	return { op, column, value };
}

function findCondition(filter: unknown, op: string, column: unknown): Condition | undefined {
	if (!filter || typeof filter !== 'object') return undefined;
	const node = filter as Condition;
	if (node.op === op && node.column === column) return node;
	for (const child of node.conditions ?? []) {
		const found = findCondition(child, op, column);
		if (found) return found;
	}
	return undefined;
}

let failureMode = 'partial';
let onDispatch = () => {};
const state = {
	events: [] as Row[],
	members: [] as Row[],
	claims: new Map<string, Claim>(),
	dispatches: [] as { memberId: string | undefined; event: string; allDay: unknown }[],
};

function selectedRows(table: unknown, filter: unknown): Row[] {
	if (table === wgEvents) return state.events;
	if (table === wgMembers) return state.members;
	if (table === idempotencyResponses) {
		const scope = findCondition(filter, 'eq', idempotencyResponses.scope)?.value;
		const keys = (findCondition(filter, 'inArray', idempotencyResponses.key)?.value ??
			[]) as string[];
		return [...state.claims.values()]
			.filter((row) => row.scope === scope && row.expiresAt > new Date())
			.filter((row) => keys.includes(row.key))
			.map((row) => ({ key: row.key }));
	}
	throw new Error('unexpected selected table');
}

const db = {
	select: () => {
		let table: unknown;
		let filter: unknown;
		const query = {
			from(value: unknown) {
				table = value;
				return query;
			},
			innerJoin() {
				return query;
			},
			where(value: unknown) {
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
		let values: Claim;
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
		let values: unknown;
		let filter: unknown;
		const query = {
			set(value: unknown) {
				values = value;
				return query;
			},
			where(value: unknown) {
				filter = value;
				const scope = findCondition(filter, 'eq', idempotencyResponses.scope)?.value;
				const key = findCondition(filter, 'eq', idempotencyResponses.key)?.value;
				const row = state.claims.get(`${scope}:${key}`);
				if (row) Object.assign(row, values as object);
				return Promise.resolve();
			},
		};
		return query;
	},
	delete: () => ({
		where(filter: unknown) {
			const scope = findCondition(filter, 'eq', idempotencyResponses.scope)?.value;
			const key = findCondition(filter, 'eq', idempotencyResponses.key)?.value;
			state.claims.delete(`${scope}:${key}`);
			return Promise.resolve();
		},
	}),
};

mock.module('@/core/db', {
	namedExports: { db, idempotencyResponses, wgEvents, wgMembers, wgs },
});
mock.module('@/core/infra/cron-auth', { namedExports: { requireCronSecret: () => null } });
mock.module('@/core/infra/observability', {
	namedExports: { withCronLogging: (_name: string, handler: unknown) => handler },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotification: async (input: Dispatch) => {
			const memberId = input.targetMemberIds[0];
			onDispatch();
			state.dispatches.push({ memberId, event: input.event, allDay: input.payload.allDay });
			if (failureMode === 'all') return { sent: 0, failures: ['provider failed'] };
			if (failureMode === 'none') return { sent: 0, failures: [] };
			if (memberId === 'member-B' && input.event === 'event.upcoming') {
				return { sent: 1, failures: ['one device failed'] };
			}
			return { sent: 1, failures: [] };
		},
	},
});
mock.module('@/features/events/server/event-reminder-window', {
	namedExports: {
		buildEventsWindowFilter: () => ({}),
		computeTomorrowUtcWindow: (now: Date) => {
			const start = nextBerlinDayStart(startOfBerlinDay(now));
			const end = new Date(nextBerlinDayStart(start).getTime() - 1);
			return { start, end };
		},
		forEachEventWindowPage: async (
			_from: unknown,
			fetchPage: (cursor: null, size: number) => Promise<unknown>,
			onPage: (rows: unknown) => Promise<boolean>,
		) => onPage(await fetchPage(null, 500)),
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
		asc: (column: unknown) => ({ op: 'asc', column }),
		eq: (column: unknown, value: unknown) => condition('eq', column, value),
		gt: (column: unknown, value: unknown) => condition('gt', column, value),
		inArray: (column: unknown, value: unknown) => condition('inArray', column, value),
		isNull: (column: unknown) => condition('isNull', column),
		lte: (column: unknown, value: unknown) => condition('lte', column, value),
		or: (...conditions: unknown[]) => ({ op: 'or', conditions }),
	},
});

const { GET } = await import('./route');

function makeHarness(options: { failureMode?: string; eventEndsAt?: string } = {}) {
	failureMode = options.failureMode ?? 'partial';
	const eventEndsAt = options.eventEndsAt ?? '2026-10-26T11:00:00.000Z';
	const event = {
		id: 'event-1',
		title: 'Treffen',
		description: null,
		startsAt: new Date('2026-10-26T10:00:00.000Z'),
		endsAt: new Date(eventEndsAt),
		allDay: false,
		location: null,
		recurrence: null,
		wgId: 'wg-1',
		wgName: 'WG',
		shareCode: 'ABCDEFGH',
	};
	Object.assign(state, {
		events: [event],
		members: [
			{ id: 'member-A', wgId: 'wg-1', deactivatedAt: null },
			{ id: 'member-B', wgId: 'wg-1', deactivatedAt: null },
		],
		claims: new Map(),
		dispatches: [],
	});
	return { state, get: (request: Request) => GET(request as never) };
}

async function withFrozenTime<T>(value: string, operation: () => Promise<T>): Promise<T> {
	const RealDate = globalThis.Date;
	const now = RealDate.parse(value);
	class FrozenDate extends RealDate {
		constructor(...args: unknown[]) {
			super(...((args.length === 0 ? [now] : args) as [number]));
		}
		static override now() {
			return now;
		}
	}
	globalThis.Date = FrozenDate as unknown as DateConstructor;
	try {
		return await operation();
	} finally {
		globalThis.Date = RealDate;
	}
}

test('a partial delivery retries only the failed member with today copy', async () => {
	const { state, get } = makeHarness();
	const request = new Request('https://example.test/api/cron/event-reminders', {
		headers: { authorization: 'Bearer cron-secret' },
	});
	await withEnv({ CRON_SECRET: 'cron-secret' }, async () => {
		const tomorrow = await withFrozenTime('2026-10-25T09:00:00.000Z', () => get(request));
		assert.equal(tomorrow.status, 503);
		assert.deepEqual(await tomorrow.json(), { ok: false, sent: 1, failed: 1 });

		const today = await withFrozenTime('2026-10-26T09:00:00.000Z', () => get(request));
		assert.equal(today.status, 200);
		assert.deepEqual(await today.json(), { ok: true, sent: 1, failed: 0 });

		const afterToday = await withFrozenTime('2026-10-27T09:00:00.000Z', () => get(request));
		assert.equal(afterToday.status, 200);
		assert.equal((await afterToday.json()).sent, 0);
	});

	assert.deepEqual(
		state.dispatches.map(({ memberId, event }) => `${memberId}:${event}`).sort(),
		['member-A:event.upcoming', 'member-B:event.today', 'member-B:event.upcoming'].sort(),
	);
});

test('all provider failures are reported with an unavailable response', async () => {
	const { get } = makeHarness({ failureMode: 'all' });
	await withEnv({ CRON_SECRET: 'cron-secret' }, async () => {
		const response = await withFrozenTime('2026-10-25T09:00:00.000Z', () =>
			get(new Request('https://example.test/api/cron/event-reminders')),
		);
		assert.equal(response.status, 503);
		assert.deepEqual(await response.json(), { ok: false, sent: 0, failed: 2 });
	});
});

test('no applicable push subscriptions are not reported as a provider failure', async () => {
	const { get } = makeHarness({ failureMode: 'none' });
	await withEnv({ CRON_SECRET: 'cron-secret' }, async () => {
		const response = await withFrozenTime('2026-10-25T09:00:00.000Z', () =>
			get(new Request('https://example.test/api/cron/event-reminders')),
		);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { ok: true, sent: 0, failed: 0 });
	});
});

test('successful claims cover long occurrences while failed members remain retryable', async () => {
	const { state, get } = makeHarness({ eventEndsAt: '2026-12-01T10:00:00.000Z' });
	await withEnv({ CRON_SECRET: 'cron-secret' }, async () => {
		const tomorrow = await withFrozenTime('2026-10-25T09:00:00.000Z', () =>
			get(new Request('https://example.test/api/cron/event-reminders')),
		);
		assert.equal(tomorrow.status, 503);
		assert.deepEqual(await tomorrow.json(), { ok: false, sent: 1, failed: 1 });

		const ongoing = await withFrozenTime('2026-11-27T09:00:00.000Z', () =>
			get(new Request('https://example.test/api/cron/event-reminders')),
		);
		assert.equal(ongoing.status, 200);
		assert.deepEqual(await ongoing.json(), { ok: true, sent: 1, failed: 0 });
	});

	assert.deepEqual(
		state.dispatches.map(({ memberId, event }) => `${memberId}:${event}`).sort(),
		['member-A:event.upcoming', 'member-B:event.today', 'member-B:event.upcoming'].sort(),
	);
});

test('a run cut off by the time budget answers 503 with complete:false', async () => {
	await withEnv({ CRON_SECRET: 'cron-secret' }, async () => {
		const { state, get } = makeHarness({ failureMode: 'ok' });
		state.members = Array.from({ length: 12 }, (_, index) => ({
			id: `member-${index}`,
			wgId: 'wg-1',
			deactivatedAt: null,
		}));
		const RealDate = globalThis.Date;
		let now = RealDate.parse('2026-10-25T09:00:00.000Z');
		class SteppedDate extends RealDate {
			constructor(...args: unknown[]) {
				super(...((args.length === 0 ? [now] : args) as [number]));
			}
			static override now() {
				return now;
			}
		}
		// The first batch of deliveries uses up the whole budget.
		onDispatch = () => {
			now += 60_000;
		};
		globalThis.Date = SteppedDate as unknown as DateConstructor;
		try {
			const response = await get(
				new Request('https://example.test/api/cron/event-reminders', {
					headers: { authorization: 'Bearer cron-secret' },
				}),
			);
			assert.equal(response.status, 503);
			const body = await response.json();
			assert.equal(body.complete, false);
			assert.equal(body.ok, false);
			assert.ok(body.sent > 0 && body.sent < 12);
		} finally {
			globalThis.Date = RealDate;
			onDispatch = () => {};
		}
	});
});
