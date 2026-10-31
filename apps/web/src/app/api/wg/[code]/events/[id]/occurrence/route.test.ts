import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const eventId = '11111111-1111-4111-8111-111111111111';
const oldVersion = new Date('2026-10-30T10:00:00.000Z');
const wgEvents = {
	id: { field: 'id' },
	wgId: { field: 'wgId' },
	updatedAt: { field: 'updatedAt' },
};
const wgMembers = { id: { field: 'id' }, wgId: { field: 'wgId' }, deactivatedAt: {} };
const auditEvents = {};

let root: Record<string, unknown>;
let detached = 0;
let callerIsAdmin = false;

beforeEach(() => {
	callerIsAdmin = false;
});

function resetRows() {
	root = {
		id: eventId,
		wgId: 'wg-1',
		title: 'Serie',
		description: null,
		startsAt: new Date('2030-01-01T18:00:00.000Z'),
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=DAILY;COUNT=3',
		createdByMemberId: 'member-1',
		createdAt: oldVersion,
		updatedAt: oldVersion,
	};
	detached = 0;
}

function transaction() {
	return {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () => {
						const rows = table === wgMembers ? [{ deactivatedAt: null }] : [{ ...root }];
						return Object.assign(Promise.resolve(rows), { for: async () => rows });
					},
				}),
			}),
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: () => ({
					returning: async () => {
						const previousUpdatedAt = root.updatedAt as Date;
						const { updatedAt, ...fields } = values;
						Object.assign(root, fields);
						if (updatedAt instanceof Date) root.updatedAt = updatedAt;
						else if (updatedAt && typeof updatedAt === 'object' && 'kind' in updatedAt) {
							root.updatedAt = new Date(Math.max(Date.now(), previousUpdatedAt.getTime() + 1));
						}
						return [{ ...root }];
					},
				}),
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: Record<string, unknown>) => {
				if (table === auditEvents) return Promise.resolve();
				detached += 1;
				return Object.assign(Promise.resolve(), {
					returning: async () => [
						{
							id: `22222222-2222-4222-8222-${String(detached).padStart(12, '0')}`,
							createdAt: oldVersion,
							updatedAt: oldVersion,
							...values,
						},
					],
				});
			},
		}),
	};
}

mock.module('@/core/audit-values', { namedExports: { auditValues: () => ({}) } });
mock.module('@/core/db', { namedExports: { auditEvents, wgEvents, wgMembers } });
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		rejectWrite: (response: Response) => ({ rejected: response }),
		responseCodec: () => ({}),
		withIdempotentWrite: async (
			options: { prepare: () => Promise<{ stop: Response } | { input: unknown }> },
			write: (tx: ReturnType<typeof transaction>) => Promise<Record<string, unknown>>,
		) => {
			const prepared = await options.prepare();
			if ('stop' in prepared) return { kind: 'stopped', response: prepared.stop };
			const result = await write(transaction());
			if ('rejected' in result) {
				return { kind: 'written', status: 409, body: null, context: result };
			}
			return { kind: 'written', ...result, context: null };
		},
	},
});
mock.module('@/core/db/transaction', {
	namedExports: { TransactionAbort: class extends Error {} },
});
mock.module('@/core/guards/admin', {
	namedExports: {
		requireOwnerOrAdmin: async (
			_wgId: string,
			member: { memberId: string },
			ownerId: string | null,
		) =>
			ownerId === member.memberId || callerIsAdmin
				? null
				: Response.json({ error: 'not_owner' }, { status: 403 }),
	},
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
mock.module('@/core/idempotency-store', { namedExports: { readIdempotencyKey: () => null } });
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/features/events/server/event-change-notification', {
	namedExports: { notifyOccurrenceChange: () => undefined },
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => conditions,
		eq: (column: unknown, value: unknown) => ({ column, value }),
		sql: (parts: string[], ...values: unknown[]) => {
			const statement = parts.join(' ');
			if (
				statement.includes('greatest(clock_timestamp(),') &&
				statement.includes("interval '1 millisecond'") &&
				values[0] === wgEvents.updatedAt
			) {
				return { kind: 'monotonic' };
			}
			throw new Error(`Unerwartete SQL im Occurrence-Test: ${statement}`);
		},
	},
});

const { POST } = await import('./route');

function detach(occurrenceStartsAt: string, title: string) {
	return POST(
		new Request('https://example.invalid/events/occurrence', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				action: 'detach',
				occurrenceStartsAt,
				title,
				startsAt: occurrenceStartsAt,
				expectedUpdatedAt: oldVersion.toISOString(),
			}),
		}) as never,
		{ params: Promise.resolve({ code: 'ABCD2345', id: eventId }) } as never,
	);
}

test('a stale detach of an event occurrence conflicts in the same millisecond', async (t) => {
	resetRows();
	t.mock.timers.enable({ apis: ['Date'], now: oldVersion });
	t.after(() => t.mock.timers.reset());

	const first = await detach('2030-01-02T18:00:00.000Z', 'Getrennt 1');
	assert.equal(first.status, 200);

	const stale = await detach('2030-01-03T18:00:00.000Z', 'Getrennt 2');
	assert.equal(stale.status, 409);
	assert.deepEqual(await stale.json(), { error: 'event_changed' });
	assert.equal(detached, 1);
});

test('a non-owner non-admin cannot edit a single occurrence', async () => {
	resetRows();
	root.createdByMemberId = 'member-2';

	const denied = await detach('2030-01-02T18:00:00.000Z', 'Fremd');
	assert.equal(denied.status, 403);
	assert.deepEqual(await denied.json(), { error: 'not_owner' });
	assert.equal(detached, 0);
	assert.equal(root.recurrence, 'FREQ=DAILY;COUNT=3');

	callerIsAdmin = true;
	const allowed = await detach('2030-01-02T18:00:00.000Z', 'Admin');
	assert.equal(allowed.status, 200);
	assert.equal(detached, 1);
});
