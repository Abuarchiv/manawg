import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const eventId = '11111111-1111-4111-8111-111111111111';
const oldVersion = new Date('2026-10-30T10:00:00.000Z');
const wgEvents = {
	id: { field: 'id' },
	wgId: { field: 'wgId' },
	updatedAt: { field: 'updatedAt' },
};

let row: Record<string, unknown>;
let loggedError: unknown;

function resetRow() {
	row = {
		id: eventId,
		wgId: 'wg-1',
		title: 'Alt',
		description: null,
		startsAt: new Date('2030-01-01T18:00:00.000Z'),
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: null,
		createdByMemberId: 'member-1',
		createdAt: oldVersion,
		updatedAt: oldVersion,
	};
}

const db = {
	select: () => ({
		from: () => ({
			where: () => ({ limit: async () => [{ ...row }] }),
		}),
	}),
	update: () => ({
		set: (values: Record<string, unknown>) => ({
			where: (conditions: unknown[]) => ({
				returning: async () => {
					const matches = conditions.every((condition) => {
						if (!condition || typeof condition !== 'object') return false;
						const entry = condition as Record<string, unknown>;
						if (entry.kind === 'equal') {
							const column = entry.column as { field?: unknown } | null;
							return (
								column !== null &&
								typeof column.field === 'string' &&
								row[column.field] === entry.value
							);
						}
						if (entry.kind === 'version') {
							return (
								entry.expected instanceof Date &&
								(row.updatedAt as Date).getTime() === entry.expected.getTime()
							);
						}
						return false;
					});
					if (!matches) return [];
					const previousUpdatedAt = row.updatedAt as Date;
					Object.assign(
						row,
						Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'updatedAt')),
					);
					const updatedAt = values.updatedAt as { kind?: string } | Date;
					if (updatedAt instanceof Date) row.updatedAt = updatedAt;
					else if (updatedAt?.kind === 'monotonic') {
						row.updatedAt = new Date(Math.max(Date.now(), previousUpdatedAt.getTime() + 1));
					}
					return [{ ...row }];
				},
			}),
		}),
	}),
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', { namedExports: { db, wgEvents } });
mock.module('@/core/guards/admin', {
	namedExports: { requireOwnerOrAdmin: async () => null },
});
mock.module('@/core/guards/api-auth', {
	namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i },
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: 'wg-1', name: 'WG', shareCode: 'ABCD2345' },
			member: { memberId: 'member-1', name: 'Alex' },
		}),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => '203.0.113.9',
		wgReadLimiter: {},
		wgWriteLimiter: {},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => undefined,
		logApiError: (_label: string, error: unknown) => {
			loggedError = error;
		},
	},
});
mock.module('@/features/events/server/event-change-notification', {
	namedExports: {
		eventRelevantUntil: () => Date.now(),
		notifyEventChange: () => undefined,
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => conditions,
		eq: (column: { field: string }, value: unknown) => ({ kind: 'equal', column, value }),
		sql: (parts: string[], ...values: unknown[]) => {
			const statement = parts.join(' ');
			if (statement.includes("date_trunc('milliseconds'") && values.at(-1) instanceof Date) {
				return { kind: 'version', expected: values.at(-1) };
			}
			if (
				statement.includes('greatest(clock_timestamp(),') &&
				statement.includes("interval '1 millisecond'") &&
				values[0] === wgEvents.updatedAt
			) {
				return { kind: 'monotonic' };
			}
			throw new Error(`Unerwartete SQL im Event-PATCH-Test: ${statement}`);
		},
	},
});

const { PATCH } = await import('./route');

function patchBody(body: unknown) {
	return PATCH(
		new Request('https://example.invalid/events', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}) as never,
		{ params: Promise.resolve({ code: 'ABCD2345', id: eventId }) } as never,
	);
}

function patch(title: string) {
	return patchBody({ title, expectedUpdatedAt: oldVersion.toISOString() });
}

test('a second stale event PATCH conflicts even in the same millisecond', async (t) => {
	resetRow();
	t.mock.timers.enable({ apis: ['Date'], now: oldVersion });
	t.after(() => t.mock.timers.reset());

	const first = await patch('Neu');
	assert.equal(first.status, 200);

	const stale = await patch('Veraltete Änderung');
	assert.equal(stale.status, 409);
	assert.deepEqual(await stale.json(), { error: 'event_changed' });
	assert.equal(row.title, 'Neu');

	const retry = await patch('Neu');
	assert.equal(retry.status, 200);
	assert.equal(row.title, 'Neu');
});

test('PATCH rejects incomplete recurrence rules with recurrence_invalid', async () => {
	resetRow();
	const response = await patchBody({
		recurrence: 'FREQ=DAILY;BYDAY=MO;COUNT=2',
		expectedUpdatedAt: oldVersion.toISOString(),
	});
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'recurrence_invalid' });
	assert.equal(row.title, 'Alt');
});

test('PATCH keeps an existing DAILY series with legacy BYDAY when editing', async () => {
	resetRow();
	loggedError = undefined;
	const legacyRule = 'FREQ=DAILY;BYDAY=MO;COUNT=3';
	row.recurrence = legacyRule;

	const response = await patchBody({
		title: 'Neu',
		recurrence: legacyRule,
		expectedUpdatedAt: oldVersion.toISOString(),
	});
	assert.equal(response.status, 200, String(loggedError));
	assert.equal(row.title, 'Neu');
	assert.equal(row.recurrence, legacyRule);
});

test('PATCH shifts EXDATE of an existing DAILY series with legacy BYDAY', async () => {
	resetRow();
	row.recurrence = 'FREQ=DAILY;BYDAY=MO;COUNT=3;EXDATE=2030-01-02T18:00:00.000Z';
	const shiftedRule = 'FREQ=DAILY;BYDAY=MO;COUNT=3;EXDATE=2030-01-03T18:00:00.000Z';

	const response = await patchBody({
		title: 'Verschoben',
		startsAt: '2030-01-02T18:00:00.000Z',
		recurrence: shiftedRule,
		expectedUpdatedAt: oldVersion.toISOString(),
	});
	assert.equal(response.status, 200);
	assert.equal((row.startsAt as Date).toISOString(), '2030-01-02T18:00:00.000Z');
	assert.equal(row.recurrence, shiftedRule);
});

test('PATCH shifts legacy EXDATE when switching to all-day across the Berlin DST change', async () => {
	resetRow();
	row.startsAt = new Date('2026-03-28T01:30:00.000Z');
	row.recurrence = 'FREQ=DAILY;BYDAY=MO;COUNT=3;EXDATE=2026-03-29T01:30:00.000Z';
	const shiftedRule = 'FREQ=DAILY;BYDAY=MO;COUNT=3;EXDATE=2026-03-29T00:00:00.000Z';

	const response = await patchBody({
		allDay: true,
		startsAt: '2026-03-28T00:00:00.000Z',
		recurrence: shiftedRule,
		expectedUpdatedAt: oldVersion.toISOString(),
	});
	assert.equal(response.status, 200);
	assert.equal(row.allDay, true);
	assert.equal((row.startsAt as Date).toISOString(), '2026-03-28T00:00:00.000Z');
	assert.equal(row.recurrence, shiftedRule);
});
