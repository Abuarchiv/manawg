import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as eventDisplay from '../src/features/events/event-display.ts';
import * as eventRecurrence from '../src/features/events/event-recurrence.ts';
import * as eventRecurrenceRule from '../src/features/events/event-recurrence-rule.ts';

type Row = Record<string, any>;
type Filter = { kind: string; parts?: unknown[]; value?: unknown } | undefined;

const id = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const calendarSubscriptions = {
	id: 'id',
	wgId: 'wgId',
	memberId: 'memberId',
	revokedAt: 'revokedAt',
};
const wgMembers = { id: 'id', authUserId: 'authUserId', deactivatedAt: 'deactivatedAt' };
const wgs = { id: 'id' };
const wgEvents = {
	id: 'id',
	wgId: 'wgId',
	startsAt: 'startsAt',
	endsAt: 'endsAt',
	allDay: 'allDay',
	recurrence: 'recurrence',
};
const drizzle = {
	and: (...parts: unknown[]) => ({ kind: 'and', parts }),
	asc: (value: unknown) => ({ kind: 'asc', value }),
	eq: (...parts: unknown[]) => ({ kind: 'eq', parts }),
	gt: (...parts: unknown[]) => ({ kind: 'gt', parts }),
	gte: (...parts: unknown[]) => ({ kind: 'gte', parts }),
	isNotNull: (value: unknown) => ({ kind: 'isNotNull', value }),
	isNull: (value: unknown) => ({ kind: 'isNull', value }),
	lte: (...parts: unknown[]) => ({ kind: 'lte', parts }),
	or: (...parts: unknown[]) => ({ kind: 'or', parts }),
};

/** Evaluates the drizzle stubs above against an event row, like the SQL WHERE would. */
function matchesEventFilter(filter: Filter, row: Row): boolean {
	if (filter === undefined) return true;
	// Duck-typed: withFrozenTime swaps the global Date class mid-test.
	const operand = (raw: any) => (typeof raw?.getTime === 'function' ? raw.getTime() : raw);
	const parts = (filter.parts ?? []) as any[];
	const value = (field: string) => operand(row[field] ?? null);
	switch (filter.kind) {
		case 'and':
			return parts.every((part) => matchesEventFilter(part, row));
		case 'or':
			return parts.some((part) => matchesEventFilter(part, row));
		case 'eq':
			return value(parts[0]) === operand(parts[1]);
		case 'gt':
			return value(parts[0]) !== null && value(parts[0]) > operand(parts[1]);
		case 'gte':
			return value(parts[0]) !== null && value(parts[0]) >= operand(parts[1]);
		case 'lte':
			return value(parts[0]) !== null && value(parts[0]) <= operand(parts[1]);
		case 'isNull':
			return value(filter.value as string) === null;
		case 'isNotNull':
			return value(filter.value as string) !== null;
		default:
			throw new Error(`unexpected filter: ${filter.kind}`);
	}
}

interface HarnessState {
	authUserId: string | null;
	deactivatedAt: Date | null;
	revokedAt: Date | null;
	wgExists: boolean;
	steps: string[];
	events: Row[];
	expansionWindows: Array<{ from: string; to: string }>;
	eventQueries: number[];
	expandedEventIds: string[];
}

// The mocks below read the state of the harness currently in use.
let current: HarnessState;
const subscription = () => ({
	id,
	wgId,
	tokenSeed: 'seed',
	memberId: 'member-1',
	revokedAt: current.revokedAt,
});

const tx = {
	select: () => {
		let table: unknown;
		let joined = false;
		let whereFilter: Filter;
		const query = {
			from(value: unknown) {
				table = value;
				return query;
			},
			innerJoin() {
				joined = true;
				return query;
			},
			where(filter: Filter) {
				whereFilter = filter;
				return query;
			},
			limit: async (count: number) => {
				const state = current;
				if (table === wgEvents) {
					state.steps.push('events');
					state.eventQueries.push(count);
					return state.events
						.map((event) => ({ wgId, ...event }))
						.filter((event) => matchesEventFilter(whereFilter, event))
						.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
						.slice(0, count);
				}
				if (table === calendarSubscriptions && joined) {
					state.steps.push('member-check');
					return state.authUserId && !state.deactivatedAt && !state.revokedAt
						? [subscription()]
						: [];
				}
				if (table === calendarSubscriptions) {
					return state.revokedAt ? [] : [{ wgId, tokenSeed: 'seed' }];
				}
				throw new Error(`unexpected limit query: ${String(table)}`);
			},
			for: async (lock: string) => {
				assert.equal(table, wgs);
				assert.equal(lock, 'share');
				current.steps.push('wg-lock');
				return current.wgExists ? [{ id: wgId, name: 'Sonnenhof' }] : [];
			},
			orderBy() {
				assert.equal(table, wgEvents);
				return query;
			},
		};
		return query;
	},
};

mock.module('@/core/db', { namedExports: { calendarSubscriptions, wgEvents, wgMembers, wgs } });
// event-reminder-window imports the schema by a relative path.
mock.module(new URL('../src/core/db/schema.ts', import.meta.url).href, {
	namedExports: { wgEvents },
});
mock.module('@/core/db/transaction', {
	namedExports: { withTransaction: async (operation: (tx: unknown) => unknown) => operation(tx) },
});
mock.module('@/core/guards/api-auth', { namedExports: { isUuid: () => true } });
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: () => undefined, captureException: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => 'ip',
		wgReadLimiter: {},
	},
});
mock.module('@/features/events/calendar-subscription', {
	namedExports: {
		isCalendarFeedToken: () => true,
		verifyCalendarFeedToken: (_id: string, seed: string, token: string) =>
			seed === 'seed' && token === 'valid',
	},
});
mock.module('@/features/events/events', {
	namedExports: {
		...eventRecurrenceRule,
		...eventRecurrence,
		...eventDisplay,
		EVENTS_LIST_LIMIT: 1000,
		expandRecurrence: (event: { id: string }, from: Date, to: Date) => {
			current.expansionWindows.push({ from: from.toISOString(), to: to.toISOString() });
			current.expandedEventIds.push(event.id);
			return eventRecurrence.expandRecurrence(event as never, from, to);
		},
	},
});
mock.module('@/features/events/ics', {
	namedExports: {
		calendarFeedToIcs: (events: Array<{ title: string }>, calendarName: string) =>
			[`CALNAME:${calendarName}`, ...events.map((event) => event.title)].join('\n'),
	},
});
mock.module('drizzle-orm', { namedExports: drizzle });

const route = await import('../src/app/api/calendar/[id]/[token]/route.ts');

function harness({
	token = 'valid',
	authUserId = 'auth-user' as string | null,
	deactivatedAt = null as Date | null,
	revokedAt = null as Date | null,
	events = [
		{
			id: 'event-1',
			title: 'Other member event',
			description: null,
			startsAt: new Date('2026-10-01T10:00:00.000Z'),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			createdAt: new Date('2026-09-25T00:00:00.000Z'),
			updatedAt: new Date('2026-09-25T00:00:00.000Z'),
		},
	] as Row[],
} = {}) {
	const state: HarnessState = {
		authUserId,
		deactivatedAt,
		revokedAt,
		wgExists: true,
		steps: [],
		events,
		expansionWindows: [],
		eventQueries: [],
		expandedEventIds: [],
	};
	const request = new Request(`https://example.test/api/calendar/${id}/${token}`);
	return {
		state,
		get: () => {
			current = state;
			return route.GET(request as never, { params: Promise.resolve({ id, token }) } as never);
		},
	};
}

async function withFrozenTime<T>(value: string, operation: () => Promise<T>): Promise<T> {
	const RealDate = globalThis.Date;
	const now = RealDate.parse(value);
	globalThis.Date = class FrozenDate extends RealDate {
		constructor(...args: unknown[]) {
			super(...((args.length === 0 ? [now] : args) as [number]));
		}
		static now() {
			return now;
		}
	} as DateConstructor;
	try {
		return await operation();
	} finally {
		globalThis.Date = RealDate;
	}
}

test('active Auth-linked calendar feed returns events after locking the WG', async () => {
	const { state, get } = harness();
	// The sample event is on 2026-10-01; with the real clock it would eventually drop out of the feed.
	const response = await withFrozenTime('2026-09-25T12:00:00.000Z', get);
	assert.equal(response.status, 200);
	const body = await response.text();
	assert.match(body, /Other member event/);
	assert.match(body, /CALNAME:ManaWG · Sonnenhof/);
	assert.deepEqual(state.steps, ['wg-lock', 'member-check', 'events']);
});

test('a wrong feed token is rejected before the WG row is locked', async () => {
	const { state, get } = harness({ token: 'stale-token' });
	const response = await get();
	assert.equal(response.status, 404);
	assert.deepEqual(state.steps, []);
});

test('detached or deactivated membership cannot use its old calendar URL', async () => {
	for (const state of [
		{ authUserId: null },
		{ deactivatedAt: new Date() },
		{ revokedAt: new Date() },
	]) {
		const { get } = harness(state);
		const response = await get();
		assert.equal(response.status, 404);
		assert.deepEqual(await response.json(), { error: 'calendar_feed_not_found' });
	}
});

test('calendar feed keeps all-day events through their final Berlin day across DST', async () => {
	for (const { now, dayStart } of [
		{ now: '2026-03-29T10:00:00.000Z', dayStart: '2026-03-28T23:00:00.000Z' },
		{ now: '2026-10-25T12:00:00.000Z', dayStart: '2026-10-24T22:00:00.000Z' },
	]) {
		const dayStartDate = new Date(dayStart);
		const previousDay = new Date(dayStartDate.getTime() - 24 * 60 * 60 * 1000);
		const { state, get } = harness({
			events: [
				{
					id: `single-${dayStart}`,
					title: 'All-day today',
					description: null,
					startsAt: dayStartDate,
					endsAt: dayStartDate,
					allDay: true,
					location: null,
					recurrence: null,
					createdAt: dayStartDate,
					updatedAt: dayStartDate,
				},
				{
					id: `span-${dayStart}`,
					title: 'All-day span ending today',
					description: null,
					startsAt: previousDay,
					endsAt: dayStartDate,
					allDay: true,
					location: null,
					recurrence: null,
					createdAt: previousDay,
					updatedAt: previousDay,
				},
			],
		});

		await withFrozenTime(now, async () => {
			const response = await get();
			assert.equal(response.status, 200);
			const body = await response.text();
			assert.match(body, /All-day today/);
			assert.match(body, /All-day span ending today/);
		});
		assert.equal(
			state.expansionWindows[0]?.to,
			new Date(dayStartDate.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
		);
	}
});

function eventRow(id: string, startsAt: string, overrides: Row = {}) {
	const start = new Date(startsAt);
	return {
		id,
		title: id,
		description: null,
		startsAt: start,
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: null,
		createdAt: start,
		updatedAt: start,
		...overrides,
	};
}

test('calendar feed loads only events that can occur in the feed window', async () => {
	const { state, get } = harness({
		events: [
			eventRow('past-single', '2024-01-10T10:00:00.000Z'),
			eventRow('recent-single', '2026-08-01T10:00:00.000Z'),
			eventRow('past-ended-series', '2024-01-01T10:00:00.000Z', {
				recurrence: 'FREQ=WEEKLY;COUNT=3',
			}),
			eventRow('old-weekly-series', '2024-01-01T10:00:00.000Z', { recurrence: 'FREQ=WEEKLY' }),
			eventRow('upcoming-single', '2026-10-01T10:00:00.000Z'),
			eventRow('beyond-horizon', '2028-01-01T10:00:00.000Z'),
		],
	});

	await withFrozenTime('2026-09-25T12:00:00.000Z', async () => {
		const response = await get();
		assert.equal(response.status, 200);
		const body = await response.text();
		assert.match(body, /old-weekly-series/);
		assert.match(body, /upcoming-single/);
		// Recent history stays in the feed so calendar apps do not delete it at midnight.
		assert.match(body, /recent-single/);
		assert.doesNotMatch(body, /past-single|past-ended-series|beyond-horizon/);
	});
	assert.deepEqual([...new Set(state.expandedEventIds)].sort(), [
		'old-weekly-series',
		'recent-single',
		'upcoming-single',
	]);
	assert.ok(state.eventQueries.every((count) => count <= 500));
});

test('calendar feed refuses an event window above the candidate cap', async () => {
	const events = Array.from({ length: 1001 }, (_, index) =>
		eventRow(`event-${String(index).padStart(4, '0')}`, '2026-10-01T10:00:00.000Z'),
	);
	const { state, get } = harness({ events });

	await withFrozenTime('2026-09-25T12:00:00.000Z', async () => {
		const response = await get();
		assert.equal(response.status, 503);
		assert.deepEqual(await response.json(), { error: 'events_window_too_large' });
	});
	assert.equal(state.expandedEventIds.length, 0);
});
