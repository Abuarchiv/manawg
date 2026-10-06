import assert from 'node:assert/strict';
import { type TestContext, mock, test } from 'node:test';
import { mockDb } from './support/db-mock';
import { mockDrizzle, rowMatches } from './support/drizzle-mock';
import { mockObservability, mockRateLimit, request } from './support/route-harness';

// The calendar feed route with the real event window, recurrence expansion and ICS output; the
// database evaluates the route's event filter against in-memory rows.

const id = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const calendarSubscriptions = { id: 'id', wgId: 'wgId', memberId: 'memberId', revokedAt: 'revokedAt' };
const wgMembers = { id: 'id', authUserId: 'authUserId', deactivatedAt: 'deactivatedAt' };
const wgs = { id: 'id' };
// Columns are the row property names, so the window filter evaluates against event rows.
const wgEvents = {
	id: 'id',
	wgId: 'wgId',
	startsAt: 'startsAt',
	endsAt: 'endsAt',
	allDay: 'allDay',
	recurrence: 'recurrence',
};

interface EventRow extends Record<string, unknown> {
	id: string;
	title: string;
	startsAt: Date;
}

function eventRow(eventId: string, startsAt: string | Date, overrides: Partial<EventRow> = {}): EventRow {
	const start = new Date(startsAt);
	return {
		id: eventId,
		title: eventId,
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

interface Options {
	token?: string;
	authUserId?: string | null;
	deactivatedAt?: Date | null;
	revokedAt?: Date | null;
	events?: EventRow[];
}

function createState(options: Options) {
	return {
		token: options.token ?? 'valid',
		authUserId: options.authUserId === undefined ? 'auth-user' : options.authUserId,
		deactivatedAt: options.deactivatedAt ?? null,
		revokedAt: options.revokedAt ?? null,
		wgExists: true,
		steps: [] as string[],
		events:
			options.events ??
			[
				eventRow('event-1', '2026-10-01T10:00:00.000Z', {
					title: 'Other member event',
					createdAt: new Date('2026-09-25T00:00:00.000Z'),
					updatedAt: new Date('2026-09-25T00:00:00.000Z'),
				}),
			],
		expansionWindows: [] as { from: string; to: string }[],
		eventQueries: [] as number[],
		expandedEventIds: [] as string[],
	};
}

let state = createState({});

const tx = {
	select: () => {
		let table: unknown;
		let joined = false;
		let whereFilter: unknown;
		const query = {
			from(value: unknown) {
				table = value;
				return query;
			},
			innerJoin() {
				joined = true;
				return query;
			},
			where(filter: unknown) {
				whereFilter = filter;
				return query;
			},
			limit: async (count: number) => {
				if (table === wgEvents) {
					state.steps.push('events');
					state.eventQueries.push(count);
					return state.events
						.map((event) => ({ wgId, ...event }))
						.filter((event) => rowMatches(event, whereFilter))
						.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
						.slice(0, count);
				}
				if (table === calendarSubscriptions && joined) {
					state.steps.push('member-check');
					return state.authUserId && !state.deactivatedAt && !state.revokedAt
						? [{ id, wgId, tokenSeed: 'seed', memberId: 'member-1', revokedAt: state.revokedAt }]
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
				state.steps.push('wg-lock');
				return state.wgExists ? [{ id: wgId, name: 'Sonnenhof' }] : [];
			},
			orderBy() {
				assert.equal(table, wgEvents);
				return query;
			},
		};
		return query;
	},
};

mockDrizzle();
mockObservability();
mockRateLimit();
mockDb({ calendarSubscriptions, wgEvents, wgMembers, wgs });
// The event window reads its columns from the schema module itself.
const schema = await import('../src/core/db/schema.ts');
mock.module('@/core/db/schema', { namedExports: { ...schema, wgEvents } });
mock.module('@/core/db/transaction', {
	namedExports: {
		withTransaction: async <T>(operation: (handle: typeof tx) => Promise<T>) => operation(tx),
	},
});
mock.module('@/features/events/calendar-subscription', {
	namedExports: {
		isCalendarFeedToken: () => true,
		verifyCalendarFeedToken: (_id: string, seed: string, token: string) =>
			seed === 'seed' && token === 'valid',
	},
});
// Recurrence expansion runs for real; the test records which events it expands and over what.
const events = await import('../src/features/events/events.ts');
mock.module('@/features/events/events', {
	namedExports: {
		...events,
		expandRecurrence: (...args: Parameters<typeof events.expandRecurrence>) => {
			const [event, from, to] = args;
			state.expansionWindows.push({ from: from.toISOString(), to: to.toISOString() });
			state.expandedEventIds.push(event.id);
			return events.expandRecurrence(...args);
		},
	},
});

const { GET } = await import('../src/app/api/calendar/[id]/[token]/route.ts');

function harness(options: Options = {}) {
	state = createState(options);
	return {
		state,
		get: () =>
			GET(request(`/api/calendar/${id}/${state.token}`), {
				params: Promise.resolve({ id, token: state.token }),
			}),
	};
}

const freeze = (t: TestContext, at: string) =>
	t.mock.timers.enable({ apis: ['Date'], now: new Date(at) });

test('active Auth-linked calendar feed returns events after locking the WG', async (t) => {
	const { get } = harness();
	// The sample event is on 2026-10-01; with the real clock it would eventually drop out of the feed.
	freeze(t, '2026-09-25T12:00:00.000Z');
	const response = await get();
	assert.equal(response.status, 200);
	const body = await response.text();
	assert.match(body, /Other member event/);
	assert.match(body, /CALNAME:ManaWG · Sonnenhof/);
	assert.deepEqual(state.steps, ['wg-lock', 'member-check', 'events']);
});

test('a wrong feed token is rejected before the WG row is locked', async () => {
	const { get } = harness({ token: 'stale-token' });
	const response = await get();
	assert.equal(response.status, 404);
	assert.deepEqual(state.steps, []);
});

test('detached or deactivated membership cannot use its old calendar URL', async () => {
	for (const options of [
		{ authUserId: null },
		{ deactivatedAt: new Date() },
		{ revokedAt: new Date() },
	]) {
		const { get } = harness(options);
		const response = await get();
		assert.equal(response.status, 404);
		assert.deepEqual(await response.json(), { error: 'calendar_feed_not_found' });
	}
});

test('calendar feed keeps all-day events through their final Berlin day across DST', async (t) => {
	for (const { now, dayStart } of [
		{ now: '2026-03-29T10:00:00.000Z', dayStart: '2026-03-28T23:00:00.000Z' },
		{ now: '2026-10-25T12:00:00.000Z', dayStart: '2026-10-24T22:00:00.000Z' },
	]) {
		const dayStartDate = new Date(dayStart);
		const previousDay = new Date(dayStartDate.getTime() - 24 * 60 * 60 * 1000);
		const { get } = harness({
			events: [
				eventRow(`single-${dayStart}`, dayStartDate, {
					title: 'All-day today',
					endsAt: dayStartDate,
					allDay: true,
				}),
				eventRow(`span-${dayStart}`, previousDay, {
					title: 'All-day span ending today',
					endsAt: dayStartDate,
					allDay: true,
				}),
			],
		});

		freeze(t, now);
		const response = await get();
		t.mock.timers.reset();
		assert.equal(response.status, 200);
		const body = await response.text();
		assert.match(body, /All-day today/);
		assert.match(body, /All-day span ending today/);
		assert.equal(
			state.expansionWindows[0]?.to,
			new Date(dayStartDate.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
		);
	}
});

test('calendar feed loads only events that can occur in the feed window', async (t) => {
	const { get } = harness({
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

	freeze(t, '2026-09-25T12:00:00.000Z');
	const response = await get();
	assert.equal(response.status, 200);
	const body = await response.text();
	assert.match(body, /old-weekly-series/);
	assert.match(body, /upcoming-single/);
	// Recent history stays in the feed so calendar apps do not delete it at midnight.
	assert.match(body, /recent-single/);
	assert.doesNotMatch(body, /past-single|past-ended-series|beyond-horizon/);
	assert.deepEqual([...new Set(state.expandedEventIds)].sort(), [
		'old-weekly-series',
		'recent-single',
		'upcoming-single',
	]);
	assert.ok(state.eventQueries.every((count) => count <= 500));
});

test('calendar feed refuses an event window above the candidate cap', async (t) => {
	const { get } = harness({
		events: Array.from({ length: 1001 }, (_, index) =>
			eventRow(`event-${String(index).padStart(4, '0')}`, '2026-10-01T10:00:00.000Z'),
		),
	});

	freeze(t, '2026-09-25T12:00:00.000Z');
	const response = await get();
	assert.equal(response.status, 503);
	assert.deepEqual(await response.json(), { error: 'events_window_too_large' });
	assert.equal(state.expandedEventIds.length, 0);
});
