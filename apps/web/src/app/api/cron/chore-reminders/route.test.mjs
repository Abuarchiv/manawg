import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const routePath = path.join(process.cwd(), 'src/app/api/cron/chore-reminders/route.ts');
const now = new Date('2026-09-25T06:00:00.000Z');

function harness({ choreCount, unassignedCount = 0 }) {
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
	const state = {
		candidateWhere: null,
		orderBy: null,
		limit: null,
		inFlight: 0,
		maxInFlight: 0,
		dispatched: [],
		payloads: [],
		targets: [],
		stamped: null,
	};
	const rows = Array.from({ length: choreCount }, (_, index) => ({
		id: `chore-${index}`,
		title: `Chore ${index}`,
		nextDueAt: new Date('2026-09-23T08:00:00.000Z'),
		assignedMemberId: `member-${index}`,
		lastReminderAt: null,
		wgId: 'wg-1',
		wgName: 'WG',
		shareCode: 'MTE8PZAT',
	}));

	const unassignedRows = Array.from({ length: unassignedCount }, (_, index) => ({
		...rows[0],
		id: `orphan-${index}`,
		title: `Unassigned ${index}`,
		assignedMemberId: null,
	}));

	const op =
		(operator) =>
		(...args) => ({ operator, args });
	const db = {
		select() {
			let table;
			let joinsMembers = false;
			const query = {
				from(selected) {
					table = selected;
					return query;
				},
				innerJoin(joined) {
					if (joined === wgMembers) joinsMembers = true;
					return query;
				},
				where(predicate) {
					if (table === choreCompletions) return Promise.resolve([]);
					// The unassigned-chore query has no member join and finds nothing here.
					if (joinsMembers) state.candidateWhere = predicate;
					return query;
				},
				orderBy(...order) {
					if (joinsMembers) state.orderBy = order;
					return query;
				},
				limit(value) {
					if (!joinsMembers) return Promise.resolve(unassignedRows.slice(0, value));
					state.limit = value;
					return Promise.resolve(rows.slice(0, value));
				},
			};
			return query;
		},
		update(table) {
			assert.equal(table, chores);
			return {
				set: () => ({
					where: async (predicate) => {
						state.stamped = predicate.args[1];
					},
				}),
			};
		},
	};

	const mocks = {
		'@/core/db': { choreCompletions, chores, db, pushSubscriptions, wgMembers, wgs },
		'@/core/infra/cron-auth': { requireCronSecret: () => null },
		'@/core/infra/observability': { withCronLogging: (_name, handler) => handler },
		'@/core/notifications/notification-dispatch': {
			dispatchNotification: async (notification) => {
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
		'@/core/utils/berlin-day': {
			startOfBerlinDay: () => new Date('2026-09-24T22:00:00.000Z'),
			endOfBerlinDay: () => new Date('2026-09-25T21:59:59.999Z'),
		},
		'drizzle-orm': {
			and: op('and'),
			asc: op('asc'),
			eq: op('eq'),
			gte: op('gte'),
			inArray: op('inArray'),
			isNotNull: op('isNotNull'),
			isNull: op('isNull'),
			lte: op('lte'),
			or: op('or'),
			sql: (strings, ...values) => ({ operator: 'sql', args: values, text: strings.join('?') }),
		},
		'next/server': {
			NextResponse: Object.assign(class extends Response {}, {
				json: (body, init) => Response.json(body, init),
			}),
		},
	};
	const source = transpileModule(readFileSync(routePath, 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', source)(
		(name) => (Object.hasOwn(mocks, name) ? mocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return {
		state,
		get: () => module.exports.GET(new Request('https://example.test/api/cron/chore-reminders')),
	};
}

async function withCronSecret(run) {
	const previousSecret = process.env.CRON_SECRET;
	process.env.CRON_SECRET = 'test-cron-secret';
	try {
		return await run();
	} finally {
		if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
		else process.env.CRON_SECRET = previousSecret;
	}
}

test('chore reminder candidates are bounded to a recent window and capped', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now });
	const { state, get } = harness({ choreCount: 3 });
	await withCronSecret(async () => {
		const response = await get();
		assert.deepEqual(await response.json(), { ok: true, sent: 3 });
	});

	const conditions = state.candidateWhere.args;
	const lowerBound = conditions.find(
		(condition) => condition.operator === 'gte' && condition.args[0] === 'chores.nextDueAt',
	);
	assert.ok(lowerBound, 'nextDueAt needs a lower bound');
	assert.equal(lowerBound.args[1].toISOString(), '2026-09-18T06:00:00.000Z');
	assert.ok(
		conditions.some(
			(condition) =>
				condition.operator === 'or' &&
				condition.args.some((inner) => inner.args[0] === 'chores.lastReminderAt'),
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
		(condition) => condition.operator === 'sql' && /exists/.test(condition.text),
	);
	assert.ok(subscriptionFilter, 'assignees without a push subscription are excluded in SQL');
	assert.deepEqual(subscriptionFilter.args.slice(1), [
		'pushSubscriptions.memberId',
		'wgMembers.id',
	]);
	assert.equal(state.limit, 500);
	assert.equal(
		state.payloads[0].nextDueAt,
		'2026-09-23T08:00:00.000Z',
		'the push copy needs nextDueAt to say whether the chore is overdue',
	);
	assert.deepEqual(
		state.orderBy.map((order) => order.args[0]),
		['chores.lastReminderAt', 'chores.nextDueAt', 'chores.id'],
	);
	assert.match(state.orderBy[0].text, /asc nulls first/);
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
	assert.equal(state.stamped.length, 45);
	assert.equal(new Set(state.stamped).size, 45);
});

test('a chore nobody is assigned to is announced to the whole WG', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now });
	const { state, get } = harness({ choreCount: 1, unassignedCount: 1 });
	await withCronSecret(async () => {
		const response = await get();
		assert.deepEqual(await response.json(), { ok: true, sent: 2 });
	});

	const index = state.payloads.findIndex((payload) => payload.choreId === 'orphan-0');
	assert.equal(state.payloads[index].unassigned, true);
	assert.equal(state.targets[index], undefined, 'no target list means every eligible member');
	const assigned = state.payloads.findIndex((payload) => payload.choreId === 'chore-0');
	assert.deepEqual(state.targets[assigned], ['member-0']);
	assert.equal(state.payloads[assigned].unassigned, undefined);
});
