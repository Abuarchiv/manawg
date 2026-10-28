import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { withEnv } from '../../../../../tests/support/env';

const now = new Date('2026-09-25T06:00:00.000Z');

type Op = { operator: string; args: unknown[]; text?: string };

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
const memberAbsences = {
	memberId: 'memberAbsences.memberId',
	startDate: 'memberAbsences.startDate',
	endDate: 'memberAbsences.endDate',
};
const pushSubscriptions = { memberId: 'pushSubscriptions.memberId' };
const wgs = { id: 'wgs.id', name: 'wgs.name', shareCode: 'wgs.shareCode' };
const idempotencyResponses = {
	scope: 'idempotency.scope',
	key: 'idempotency.key',
	expiresAt: 'idempotency.expiresAt',
	responseBody: 'idempotency.responseBody',
};

const state = {
	candidateWhere: null as Op | null,
	orderBy: null as Op[] | null,
	limit: null as number | null,
	inFlight: 0,
	maxInFlight: 0,
	dispatched: [] as string[],
	payloads: [] as { choreId: string; nextDueAt?: string; unassigned?: boolean }[],
	targets: [] as (string[] | undefined)[],
	stamped: null as unknown[] | null,
	rows: [] as Record<string, unknown>[],
	unassignedRows: [] as Record<string, unknown>[],
	claims: new Set<string>(),
};

const op =
	(operator: string) =>
	(...args: unknown[]): Op => ({ operator, args });
const db = {
	select() {
		let table: unknown;
		let joinsMembers = false;
		const query = {
			from(selected: unknown) {
				table = selected;
				return query;
			},
			innerJoin(joined: unknown) {
				if (joined === wgMembers) joinsMembers = true;
				return query;
			},
			where(predicate: Op) {
				if (table === choreCompletions) return Promise.resolve([]);
				// The unassigned-chore query has no member join and finds nothing here.
				if (joinsMembers) state.candidateWhere = predicate;
				return query;
			},
			orderBy(...order: Op[]) {
				if (joinsMembers) state.orderBy = order;
				return query;
			},
			limit(value: number) {
				if (!joinsMembers) return Promise.resolve(state.unassignedRows.slice(0, value));
				state.limit = value;
				return Promise.resolve(state.rows.slice(0, value));
			},
		};
		return query;
	},
	insert(table: unknown) {
		assert.equal(table, idempotencyResponses);
		return {
			values: (row: { key: string }) => ({
				onConflictDoNothing: () => ({
					returning: async () => {
						if (state.claims.has(row.key)) return [];
						state.claims.add(row.key);
						return [{ key: row.key }];
					},
				}),
			}),
		};
	},
	delete(table: unknown) {
		assert.equal(table, idempotencyResponses);
		return {
			where: async (predicate: Op) => {
				const keyCondition = predicate.args[1] as Op;
				state.claims.delete(keyCondition.args[1] as string);
			},
		};
	},
	update(table: unknown) {
		assert.equal(table, chores);
		return {
			set: () => ({
				where: async (predicate: Op) => {
					state.stamped = predicate.args[1] as unknown[];
				},
			}),
		};
	},
};

mock.module('@/core/db', {
	namedExports: {
		choreCompletions,
		chores,
		db,
		idempotencyResponses,
		memberAbsences,
		pushSubscriptions,
		wgMembers,
		wgs,
	},
});
mock.module('@/core/infra/cron-auth', { namedExports: { requireCronSecret: () => null } });
mock.module('@/core/infra/observability', {
	namedExports: { withCronLogging: (_name: string, handler: unknown) => handler },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotification: async (notification: {
			payload: { choreId: string };
			targetMemberIds?: string[];
		}) => {
			state.inFlight += 1;
			state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
			await new Promise((resolve) => setImmediate(resolve));
			state.inFlight -= 1;
			state.dispatched.push(notification.payload.choreId);
			state.payloads.push(notification.payload);
			state.targets.push(notification.targetMemberIds);
			return { sent: 1, failures: [] };
		},
	},
});
mock.module('@/core/utils/berlin-day', {
	namedExports: {
		startOfBerlinDay: () => new Date('2026-09-24T22:00:00.000Z'),
		endOfBerlinDay: () => new Date('2026-09-25T21:59:59.999Z'),
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: op('and'),
		asc: op('asc'),
		eq: op('eq'),
		gte: op('gte'),
		inArray: op('inArray'),
		isNotNull: op('isNotNull'),
		isNull: op('isNull'),
		lte: op('lte'),
		or: op('or'),
		sql: (strings: TemplateStringsArray, ...values: unknown[]): Op => ({
			operator: 'sql',
			args: values,
			text: strings.join('?'),
		}),
	},
});

const { GET } = await import('./route');

let harnessRuns = 0;

function chore(index: number) {
	return {
		id: `chore-${harnessRuns}-${index}`,
		title: `Chore ${index}`,
		nextDueAt: new Date('2026-09-23T08:00:00.000Z'),
		assignedMemberId: `member-${index}`,
		lastReminderAt: null,
		wgId: 'wg-1',
		wgName: 'WG',
		shareCode: 'MTE8PZAT',
	};
}

function harness({
	choreCount,
	unassignedCount = 0,
}: {
	choreCount: number;
	unassignedCount?: number;
}) {
	harnessRuns += 1;
	Object.assign(state, {
		candidateWhere: null,
		orderBy: null,
		limit: null,
		inFlight: 0,
		maxInFlight: 0,
		dispatched: [],
		payloads: [],
		targets: [],
		stamped: null,
		claims: new Set<string>(),
		rows: Array.from({ length: choreCount }, (_, index) => chore(index)),
		unassignedRows: Array.from({ length: unassignedCount }, (_, index) => ({
			...chore(index),
			id: `orphan-${harnessRuns}-${index}`,
			title: `Unassigned ${index}`,
			assignedMemberId: null,
		})),
	});
	return {
		state,
		get: () => GET(new Request('https://example.test/api/cron/chore-reminders') as never),
	};
}

async function withCronSecret<T>(run: () => Promise<T>): Promise<T> {
	return withEnv({ CRON_SECRET: 'test-cron-secret' }, run);
}

test('chore reminder candidates are bounded to a recent window and capped', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now });
	const { state, get } = harness({ choreCount: 3 });
	await withCronSecret(async () => {
		const response = await get();
		assert.deepEqual(await response.json(), { ok: true, sent: 3 });
	});

	const conditions = (state.candidateWhere?.args ?? []) as Op[];
	const lowerBound = conditions.find(
		(condition) => condition.operator === 'gte' && condition.args[0] === 'chores.nextDueAt',
	);
	assert.ok(lowerBound, 'nextDueAt needs a lower bound');
	assert.equal((lowerBound.args[1] as Date).toISOString(), '2026-09-18T06:00:00.000Z');
	assert.ok(
		conditions.some(
			(condition) =>
				condition.operator === 'or' &&
				(condition.args as Op[]).some((inner) => inner.args[0] === 'chores.lastReminderAt'),
		),
		'throttled chores are excluded in SQL so the cap drains the backlog',
	);
	assert.ok(
		conditions.some(
			(condition) =>
				condition.operator === 'eq' &&
				condition.args[0] === 'wgMembers.pushOptIn' &&
				condition.args[1] === true,
		),
		'assignees without push opt-in are excluded in SQL',
	);
	assert.ok(
		conditions.some(
			(condition) =>
				condition.operator === 'eq' &&
				condition.args[0] === 'wgMembers.notifyChores' &&
				condition.args[1] === true,
		),
		'assignees with muted chore notifications are excluded in SQL',
	);
	const subscriptionFilter = conditions.find(
		(condition) => condition.operator === 'sql' && /exists/.test(condition.text ?? ''),
	);
	assert.ok(subscriptionFilter, 'assignees without a push subscription are excluded in SQL');
	assert.deepEqual(subscriptionFilter.args.slice(1), [
		'pushSubscriptions.memberId',
		'wgMembers.id',
	]);
	const absenceFilter = conditions.find(
		(condition) => condition.operator === 'sql' && /not exists/.test(condition.text ?? ''),
	);
	assert.ok(absenceFilter, 'assignees who are absent today are excluded in SQL');
	assert.deepEqual(absenceFilter.args.slice(1), [
		'memberAbsences.memberId',
		'chores.assignedMemberId',
		'memberAbsences.startDate',
		new Date('2026-09-25T21:59:59.999Z'),
		'memberAbsences.endDate',
		new Date('2026-09-24T22:00:00.000Z'),
	]);
	assert.equal(state.limit, 500);
	assert.equal(
		state.payloads[0]?.nextDueAt,
		'2026-09-23T08:00:00.000Z',
		'the push copy needs nextDueAt to say whether the chore is overdue',
	);
	assert.deepEqual(
		(state.orderBy ?? []).map((order) => order.args[0]),
		['chores.lastReminderAt', 'chores.nextDueAt', 'chores.id'],
	);
	assert.match(state.orderBy?.[0]?.text ?? '', /asc nulls first/);
});

test('a large reminder backlog is dispatched in batches of ten', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now });
	const { state, get } = harness({ choreCount: 45 });
	await withCronSecret(async () => {
		const response = await get();
		assert.deepEqual(await response.json(), { ok: true, sent: 45 });
	});

	assert.equal(state.maxInFlight, 10);
	assert.equal(state.dispatched.length, 45);
	assert.equal(state.stamped?.length, 45);
	assert.equal(new Set(state.stamped).size, 45);
});

test('a chore nobody is assigned to is announced to the whole WG', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now });
	const { state, get } = harness({ choreCount: 1, unassignedCount: 1 });
	await withCronSecret(async () => {
		const response = await get();
		assert.deepEqual(await response.json(), { ok: true, sent: 2 });
	});

	const orphan = state.payloads.findIndex((payload) => payload.choreId.startsWith('orphan-'));
	assert.equal(state.payloads[orphan]?.unassigned, true);
	assert.equal(state.targets[orphan], undefined, 'no target list means every eligible member');
	const assigned = state.payloads.findIndex((payload) => payload.choreId.startsWith('chore-'));
	assert.deepEqual(state.targets[assigned], ['member-0']);
	assert.equal(state.payloads[assigned]?.unassigned, undefined);
});
