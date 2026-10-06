import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../tests/support/db-mock';
import { type SqlNode, mockDrizzle } from '../../../../../tests/support/drizzle-mock';
import { mockObservability, request } from '../../../../../tests/support/route-harness';

const now = new Date('2026-09-25T06:00:00.000Z');
const CRON_SECRET = 'test-cron-secret';

const chores = {
	id: 'chores.id',
	title: 'chores.title',
	assignedMemberId: 'chores.assignedMemberId',
	lastReminderAt: 'chores.lastReminderAt',
	nextDueAt: 'chores.nextDueAt',
	wgId: 'chores.wgId',
};
const choreCompletions = { choreId: 'choreCompletions.choreId', completedAt: 'c.completedAt' };
const wgMembers = {
	id: 'wgMembers.id',
	deactivatedAt: 'wgMembers.deactivatedAt',
	pushOptIn: 'wgMembers.pushOptIn',
	notifyChores: 'wgMembers.notifyChores',
};
const pushSubscriptions = { memberId: 'pushSubscriptions.memberId' };
const wgs = { id: 'wgs.id', name: 'wgs.name', shareCode: 'wgs.shareCode' };

interface Payload {
	choreId: string;
	nextDueAt: string;
}

const state = {
	rows: [] as Record<string, unknown>[],
	candidateWhere: null as SqlNode | null,
	orderBy: [] as SqlNode[],
	limit: null as number | null,
	inFlight: 0,
	maxInFlight: 0,
	dispatched: [] as string[],
	payloads: [] as Payload[],
	stamped: [] as string[],
};

/** Due chores; the in-process claim map outlives a test, so each test uses its own ids. */
function given(choreCount: number, idPrefix: string): void {
	state.rows = Array.from({ length: choreCount }, (_, index) => ({
		id: `${idPrefix}-${index}`,
		title: `Chore ${index}`,
		nextDueAt: new Date('2026-09-23T08:00:00.000Z'),
		assignedMemberId: `member-${index}`,
		lastReminderAt: null,
		wgId: 'wg-1',
		wgName: 'WG',
		shareCode: 'MTE8PZAT',
	}));
	state.candidateWhere = null;
	state.orderBy = [];
	state.limit = null;
	state.inFlight = 0;
	state.maxInFlight = 0;
	state.dispatched = [];
	state.payloads = [];
	state.stamped = [];
}

mockDrizzle();
mockObservability();
mockDb({
	choreCompletions,
	chores,
	pushSubscriptions,
	wgMembers,
	wgs,
	db: {
		select() {
			let table: unknown;
			const query = {
				from(selected: unknown) {
					table = selected;
					return query;
				},
				innerJoin() {
					return query;
				},
				where(predicate: SqlNode) {
					if (table === choreCompletions) return Promise.resolve([]);
					state.candidateWhere = predicate;
					return query;
				},
				orderBy(...order: SqlNode[]) {
					state.orderBy = order;
					return query;
				},
				limit(value: number) {
					state.limit = value;
					return Promise.resolve(state.rows.slice(0, value));
				},
			};
			return query;
		},
		update(table: unknown) {
			assert.equal(table, chores);
			return {
				set: () => ({
					where: async (predicate: SqlNode) => {
						state.stamped = predicate.args[1] as string[];
					},
				}),
			};
		},
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotification: async (notification: { payload: Payload }) => {
			state.inFlight += 1;
			state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
			await new Promise((resolve) => setImmediate(resolve));
			state.inFlight -= 1;
			state.dispatched.push(notification.payload.choreId);
			state.payloads.push(notification.payload);
			return { sent: 1, failures: [] };
		},
	},
});

const { GET } = await import('./route');

async function run(): Promise<unknown> {
	const previousSecret = process.env.CRON_SECRET;
	process.env.CRON_SECRET = CRON_SECRET;
	try {
		const response = await GET(
			request('/api/cron/chore-reminders', {
				headers: { authorization: `Bearer ${CRON_SECRET}` },
			}),
		);
		return await response.json();
	} finally {
		if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
		else process.env.CRON_SECRET = previousSecret;
	}
}

const conditionsOf = (where: SqlNode | null) => (where?.args ?? []) as SqlNode[];

test('chore reminder candidates are bounded to a recent window and capped', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now });
	given(3, 'window');
	assert.deepEqual(await run(), { ok: true, sent: 3 });

	const conditions = conditionsOf(state.candidateWhere);
	const lowerBound = conditions.find(
		(condition) => condition.op === 'gte' && condition.args[0] === 'chores.nextDueAt',
	);
	assert.ok(lowerBound, 'nextDueAt needs a lower bound');
	assert.equal((lowerBound.args[1] as Date).toISOString(), '2026-09-18T06:00:00.000Z');
	assert.ok(
		conditions.some(
			(condition) =>
				condition.op === 'or' &&
				condition.args.some((inner) => (inner as SqlNode).args[0] === 'chores.lastReminderAt'),
		),
		'throttled chores are excluded in SQL so the cap drains the backlog',
	);
	assert.ok(
		conditions.some(
			(condition) =>
				condition.op === 'eq' &&
				condition.args[0] === 'wgMembers.pushOptIn' &&
				condition.args[1] === true,
		),
		'assignees without push opt-in are excluded in SQL',
	);
	assert.ok(
		conditions.some(
			(condition) =>
				condition.op === 'eq' &&
				condition.args[0] === 'wgMembers.notifyChores' &&
				condition.args[1] === true,
		),
		'assignees with muted chore notifications are excluded in SQL',
	);
	const subscriptionFilter = conditions.find(
		(condition) => condition.op === 'sql' && /exists/.test(condition.text ?? ''),
	);
	assert.ok(subscriptionFilter, 'assignees without a push subscription are excluded in SQL');
	assert.deepEqual(subscriptionFilter.args.slice(1), [
		'pushSubscriptions.memberId',
		'wgMembers.id',
	]);
	assert.equal(state.limit, 500);
	assert.equal(
		state.payloads[0]?.nextDueAt,
		'2026-09-23T08:00:00.000Z',
		'the push copy needs nextDueAt to say whether the chore is overdue',
	);
	assert.deepEqual(
		state.orderBy.map((order) => order.args[0]),
		['chores.lastReminderAt', 'chores.nextDueAt', 'chores.id'],
	);
	assert.match(state.orderBy[0]?.text ?? '', /asc nulls first/);
});

test('a large reminder backlog is dispatched in batches of ten', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now });
	given(45, 'backlog');
	assert.deepEqual(await run(), { ok: true, sent: 45 });

	assert.equal(state.maxInFlight, 10);
	assert.equal(state.dispatched.length, 45);
	assert.equal(state.stamped.length, 45);
	assert.equal(new Set(state.stamped).size, 45);
});
