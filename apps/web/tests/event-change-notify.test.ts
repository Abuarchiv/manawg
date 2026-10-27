import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { auditEvents, wgEvents, wgMembers } from '../src/core/db/schema.ts';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';

const wgId = '989ac820-58b7-431f-9c65-28721264f333';
const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const eventId = '550e8400-e29b-41d4-a716-446655440000';
const DAY = 24 * 60 * 60 * 1000;
// biome-ignore lint/suspicious/noExplicitAny: fake rows carry arbitrary shapes
type Row = Record<string, any>;

const dispatched: Row[] = [];
let selectRows: Row[] = [];
let updateRows: Row[] = [];
let deleteRows: Row[] = [{ id: eventId }];
let writeBody: Row = {};

const fakeRows = (rows: () => Row[]) => ({
	where: () => ({ limit: async () => rows(), returning: async () => rows() }),
});
const db = {
	select: () => ({ from: () => fakeRows(() => selectRows) }),
	update: () => ({ set: () => fakeRows(() => updateRows) }),
	delete: () => fakeRows(() => deleteRows),
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', { namedExports: { db, wgEvents, wgMembers, auditEvents } });
mock.module('@/core/db/transaction', { namedExports: { TransactionAbort } });
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		rejectWrite: (rejected: unknown) => rejected,
		responseCodec: () => ({}),
		withIdempotentWrite: async () => ({ kind: 'written', status: 200, body: writeBody }),
	},
});
mock.module('@/core/guards/admin', { namedExports: { requireOwnerOrAdmin: async () => null } });
mock.module('@/core/guards/api-auth', {
	namedExports: {
		UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId, name: 'WG', shareCode: 'ABCDEFGH' },
			member: { memberId, name: 'Mina' },
		}),
	},
});
mock.module('@/core/guards/with-wg-route', {
	namedExports: {
		withWgRoute:
			(_name: string, handler: (...args: unknown[]) => Promise<Response>) =>
			(...args: unknown[]) =>
				handler(...args),
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: { readIdempotencyKey: () => null },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => 'ip',
		wgReadLimiter: {},
		wgWriteLimiter: {},
	},
});
mock.module('@/core/infra/after-response', {
	namedExports: { afterResponse: (task: () => Promise<unknown>) => void task() },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async (input: Row) => {
			dispatched.push(input);
			return { sent: 1, warning: null };
		},
	},
});

const itemRoute = await import('../src/app/api/wg/[code]/events/[id]/route.ts');
const occurrenceRoute = await import('../src/app/api/wg/[code]/events/[id]/occurrence/route.ts');

const params = { code: 'ABCDEFGH', id: eventId };
const request = (method: string, body?: unknown) =>
	new Request('http://localhost/api', {
		method,
		headers: { 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
const call = (handler: unknown, method: string, body?: unknown) =>
	(handler as (req: Request, ctx: unknown) => Promise<Response>)(request(method, body), params);

const futureStart = new Date(Date.now() + 5 * DAY);
const movedStart = new Date(Date.now() + 6 * DAY);
const eventRow = (startsAt: Date, extra: Row = {}): Row => ({
	id: eventId,
	wgId,
	title: 'Plenum',
	description: null,
	startsAt,
	endsAt: null,
	allDay: false,
	location: null,
	recurrence: null,
	createdByMemberId: memberId,
	createdAt: new Date(),
	updatedAt: new Date(),
	...extra,
});

function reset(): void {
	dispatched.length = 0;
	deleteRows = [{ id: eventId }];
}

test('moving a future event notifies the other members with the new start', async () => {
	reset();
	selectRows = [eventRow(futureStart)];
	updateRows = [eventRow(movedStart)];
	const res = await call(itemRoute.PATCH, 'PATCH', { startsAt: movedStart.toISOString() });
	assert.equal(res.status, 200);
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0]?.event, 'event.moved');
	assert.equal(dispatched[0]?.excludeMemberId, memberId);
	assert.equal(dispatched[0]?.payload.startsAt, movedStart.toISOString());
	assert.equal(dispatched[0]?.payload.eventId, eventId);
	assert.equal(dispatched[0]?.payload.recurring, false);
});

test('editing only the title stays silent', async () => {
	reset();
	selectRows = [eventRow(futureStart)];
	updateRows = [eventRow(futureStart, { title: 'Neu' })];
	const res = await call(itemRoute.PATCH, 'PATCH', { title: 'Neu' });
	assert.equal(res.status, 200);
	assert.equal(dispatched.length, 0);
});

test('moving an event that lies entirely in the past stays silent', async () => {
	reset();
	const past = new Date(Date.now() - 9 * DAY);
	selectRows = [eventRow(past)];
	updateRows = [eventRow(new Date(Date.now() - 8 * DAY))];
	await call(itemRoute.PATCH, 'PATCH', { startsAt: new Date(Date.now() - 8 * DAY).toISOString() });
	assert.equal(dispatched.length, 0);
});

test('deleting a future event notifies about the cancellation without a link target', async () => {
	reset();
	selectRows = [eventRow(futureStart)];
	const res = await call(itemRoute.DELETE, 'DELETE');
	assert.equal(res.status, 200);
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0]?.event, 'event.cancelled');
	assert.equal(dispatched[0]?.excludeMemberId, memberId);
	assert.equal(dispatched[0]?.payload.eventId, undefined);
	assert.equal(dispatched[0]?.payload.title, 'Plenum');
});

test('deleting a past single event stays silent', async () => {
	reset();
	selectRows = [eventRow(new Date(Date.now() - 9 * DAY))];
	await call(itemRoute.DELETE, 'DELETE');
	assert.equal(dispatched.length, 0);
});

test('cancelling one future occurrence notifies with the occurrence start', async () => {
	reset();
	const occurrenceStartsAt = futureStart.toISOString();
	writeBody = { event: { title: 'Plenum', allDay: false }, created: null };
	const res = await call(occurrenceRoute.POST, 'POST', { action: 'cancel', occurrenceStartsAt });
	assert.equal(res.status, 200);
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0]?.event, 'event.cancelled');
	assert.equal(dispatched[0]?.payload.startsAt, occurrenceStartsAt);
	assert.equal(dispatched[0]?.excludeMemberId, memberId);
});

test('detaching an occurrence to a new time notifies, a title-only detach stays silent', async () => {
	reset();
	const occurrenceStartsAt = futureStart.toISOString();
	writeBody = { event: { title: 'Plenum', allDay: false }, created: { id: 'new-event' } };
	await call(occurrenceRoute.POST, 'POST', {
		action: 'detach',
		occurrenceStartsAt,
		title: 'Plenum',
		startsAt: movedStart.toISOString(),
	});
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0]?.event, 'event.moved');
	assert.equal(dispatched[0]?.payload.eventId, 'new-event');
	assert.equal(dispatched[0]?.payload.startsAt, movedStart.toISOString());

	reset();
	await call(occurrenceRoute.POST, 'POST', {
		action: 'detach',
		occurrenceStartsAt,
		title: 'Anderer Titel',
		startsAt: occurrenceStartsAt,
	});
	assert.equal(dispatched.length, 0);
});

test('deleting today’s all-day event after midnight still notifies, urgently', async () => {
	reset();
	const todayMidnight = new Date(Date.now() - 6 * 60 * 60 * 1000);
	selectRows = [eventRow(todayMidnight, { allDay: true })];
	await call(itemRoute.DELETE, 'DELETE');
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0]?.event, 'event.cancelled');
	assert.equal(dispatched[0]?.urgent, true);
});

test('a change to an event more than a day away respects quiet hours', async () => {
	reset();
	selectRows = [eventRow(futureStart)];
	await call(itemRoute.DELETE, 'DELETE');
	assert.equal(dispatched[0]?.urgent, false);
});

test('detaching an occurrence to all-day at the same start counts as moved', async () => {
	reset();
	const occurrenceStartsAt = futureStart.toISOString();
	writeBody = { event: { title: 'Plenum', allDay: false }, created: { id: 'new-event' } };
	await call(occurrenceRoute.POST, 'POST', {
		action: 'detach',
		occurrenceStartsAt,
		title: 'Plenum',
		startsAt: occurrenceStartsAt,
		allDay: true,
	});
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0]?.event, 'event.moved');
});

test('postponing a past event to next week respects quiet hours', async () => {
	reset();
	selectRows = [eventRow(new Date(Date.now() - 3 * DAY))];
	updateRows = [eventRow(movedStart)];
	await call(itemRoute.PATCH, 'PATCH', { startsAt: movedStart.toISOString() });
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0]?.urgent, false);
});
