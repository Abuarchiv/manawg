import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../tests/support/db-mock';
import {
	type SqlNode,
	isSqlNode,
	mockDrizzle,
	rowMatches,
} from '../../../../../tests/support/drizzle-mock';
import { request } from '../../../../../tests/support/route-harness';

// The cron route and the recurring-expense helpers run for real against one template row; edits
// by other requests are injected at the points where they can interleave with the cron.

const CRON_SECRET = 'test-cron-secret';
const templateId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const originalDueAt = new Date('2026-09-01T00:00:00.000Z');
const editedDueAt = new Date('2027-01-15T00:00:00.000Z');
const NOW = new Date('2026-09-25T12:00:00.000Z');

// Template columns are named after the row properties, so conditions evaluate against the row.
const recurringExpenses = {
	id: 'id',
	wgId: 'wgId',
	paidByMemberId: 'paidByMemberId',
	description: 'description',
	amountCents: 'amountCents',
	intervalMonths: 'intervalMonths',
	nextDueAt: 'nextDueAt',
	anchorAt: 'anchorAt',
	splitsJson: 'splitsJson',
	pausedAt: 'pausedAt',
};
const expenses = { id: 'expenses.id' };
const expenseSplits = {};
const wgs = { id: 'wgs.id', name: 'wgs.name', shareCode: 'wgs.shareCode' };
const wgMembers = {
	id: 'wgMembers.id',
	wgId: 'wgMembers.wgId',
	deactivatedAt: 'wgMembers.deactivatedAt',
};

interface Options {
	patchIntervalMonths?: boolean;
	patchBeforeLock?: 'deleteWg' | 'pause' | 'amount' | null;
	patchAfterInsert?: 'dueDate' | null;
	initialDueAt?: Date;
	initialIntervalMonths?: number;
	errorConstraint?: string | null;
	duplicateErrorShape?: 'cause' | 'direct';
	initialAnchorAt?: Date | null;
	activeMemberIds?: string[];
}

interface Template extends Record<string, unknown> {
	nextDueAt: Date;
	anchorAt: Date | null;
	pausedAt: Date | null;
	intervalMonths: number;
	amountCents: number;
	splitsJson: string;
}
interface ExpenseRow extends Record<string, unknown> {
	recurringExpenseId: string;
	recurringDueAt: Date;
}

function createState(options: Options) {
	const initialDueAt = options.initialDueAt ?? originalDueAt;
	return {
		options: {
			patchIntervalMonths: options.patchIntervalMonths ?? false,
			patchBeforeLock: options.patchBeforeLock ?? null,
			patchAfterInsert:
				options.patchAfterInsert === undefined ? 'dueDate' : options.patchAfterInsert,
			errorConstraint: options.errorConstraint ?? null,
			duplicateErrorShape: options.duplicateErrorShape ?? 'cause',
			activeMemberIds: options.activeMemberIds ?? [memberId],
		},
		template: {
			id: templateId,
			wgId,
			paidByMemberId: memberId,
			description: 'Miete',
			amountCents: 500,
			intervalMonths: options.initialIntervalMonths ?? 1,
			nextDueAt: initialDueAt,
			anchorAt: options.initialAnchorAt === undefined ? initialDueAt : options.initialAnchorAt,
			splitsJson: JSON.stringify([{ debtorMemberId: memberId, amountCents: 500 }]),
			pausedAt: null,
			wgName: 'WG',
			shareCode: 'MTE8PZAT',
		} as Template,
		expenses: [] as ExpenseRow[],
		splits: [] as unknown[],
		notifications: [] as unknown[],
		events: [] as unknown[],
		updateResults: [] as unknown[][],
		concurrentPatchApplied: false,
		lockPatchApplied: false,
		lockReads: 0,
		lockOrder: [] as string[],
		capturing: false,
		wgExists: true,
		loggedErrors: [] as unknown[][],
		memberQueries: [] as unknown[][],
	};
}

type State = ReturnType<typeof createState>;
let state: State = createState({});

function harness(options: Options = {}) {
	state = createState(options);
	return {
		state,
		get: async () => {
			const previousSecret = process.env.CRON_SECRET;
			process.env.CRON_SECRET = CRON_SECRET;
			try {
				return await GET(
					request('/api/cron/recurring-advance', {
						headers: { authorization: `Bearer ${CRON_SECRET}` },
					}),
				);
			} finally {
				if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
				else process.env.CRON_SECRET = previousSecret;
			}
		},
	};
}

const templateMatches = (predicate: unknown) =>
	rowMatches({ ...state.template, [wgs.id]: wgId }, predicate);

function partOf(predicate: unknown, op: string): SqlNode | undefined {
	if (!isSqlNode(predicate)) return undefined;
	return (predicate.args as unknown[]).find(
		(part): part is SqlNode => isSqlNode(part) && part.op === op,
	);
}

function duplicateRecurringCharge(): Error {
	if (state.options.duplicateErrorShape === 'cause') {
		return new Error('duplicate recurring charge', {
			cause: { code: '23505', constraint_name: 'expenses_recurring_due_unique_idx' },
		});
	}
	return Object.assign(new Error('duplicate recurring charge'), {
		code: '23505',
		constraint: 'expenses_recurring_due_unique_idx',
	});
}

const transaction = {
	select() {
		let table: unknown;
		const query = {
			from(selectedTable: unknown) {
				table = selectedTable;
				return query;
			},
			where(predicate: unknown) {
				if (table === wgMembers) {
					const ids = partOf(predicate, 'inArray')?.args[1] as string[];
					state.memberQueries.push(ids);
					return Promise.resolve(
						ids.filter((id) => state.options.activeMemberIds.includes(id)).map((id) => ({ id })),
					);
				}
				assert.equal(templateMatches(predicate), true);
				return query;
			},
			for(mode: string) {
				const tableName = table === wgs ? 'wgs' : 'recurringExpenses';
				state.lockOrder.push(`${tableName}:${mode}`);
				if (table === wgs) {
					assert.equal(mode, 'key share');
					return Promise.resolve(state.wgExists ? [{ id: wgId }] : []);
				}
				assert.equal(table, recurringExpenses);
				assert.equal(mode, 'update');
				state.lockReads++;
				return Promise.resolve([{ ...state.template }]);
			},
		};
		return query;
	},
	insert(table: unknown) {
		return {
			values(value: ExpenseRow | unknown[]) {
				if (table === expenses) {
					const row = value as ExpenseRow;
					return {
						returning: async () => {
							if (state.options.errorConstraint) {
								throw Object.assign(new Error('unrelated unique violation'), {
									code: '23505',
									constraint: state.options.errorConstraint,
								});
							}
							const duplicate = state.expenses.some(
								(existing) =>
									existing.recurringExpenseId === row.recurringExpenseId &&
									existing.recurringDueAt.getTime() === row.recurringDueAt.getTime(),
							);
							if (duplicate) throw duplicateRecurringCharge();
							const inserted = { ...row, id: `expense-${state.expenses.length + 1}` };
							state.expenses.push(inserted);
							return [{ id: inserted.id }];
						},
					};
				}
				assert.equal(table, expenseSplits);
				state.splits.push(...(value as unknown[]));
				return Promise.resolve();
			},
		};
	},
};

/** A concurrent edit lands between the charge insert and the cron's own advance. */
function applyConcurrentPatch(): void {
	if (state.concurrentPatchApplied) return;
	state.concurrentPatchApplied = true;
	if (state.options.patchIntervalMonths) state.template.intervalMonths = 3;
	else if (state.options.patchAfterInsert === 'dueDate') {
		state.template.nextDueAt = editedDueAt;
		state.template.anchorAt = editedDueAt;
	}
}

/** A commit by another request lands right before the cron takes the payment lock. */
function applyPatchBeforeLock(): void {
	const patch = state.options.patchBeforeLock;
	if (state.lockPatchApplied || !patch) return;
	state.lockPatchApplied = true;
	if (patch === 'deleteWg') state.wgExists = false;
	if (patch === 'pause') state.template.pausedAt = new Date('2026-09-20T00:00:00Z');
	if (patch === 'amount') {
		state.template.amountCents = 600;
		state.template.splitsJson = JSON.stringify([{ debtorMemberId: memberId, amountCents: 600 }]);
	}
}

mockDrizzle();
mockDb({
	expenseSplits,
	expenses,
	recurringExpenses,
	wgMembers,
	wgs,
	db: {
		select() {
			const query = {
				from(table: unknown) {
					assert.equal(table, recurringExpenses);
					return query;
				},
				innerJoin(table: unknown) {
					assert.equal(table, wgs);
					return query;
				},
				where(predicate: unknown) {
					const dueBy = partOf(predicate, 'lte')?.args[1] as Date;
					const due = state.template.nextDueAt <= dueBy && state.template.pausedAt === null;
					const rows = Promise.resolve(due ? [{ ...state.template }] : []);
					return Object.assign(rows, { orderBy: () => ({ limit: () => rows }) });
				},
			};
			return query;
		},
		update(table: unknown) {
			assert.equal(table, recurringExpenses);
			let values: Partial<Template> = {};
			const update = {
				set(nextValues: Partial<Template>) {
					values = nextValues;
					return update;
				},
				where(predicate: unknown) {
					let result: unknown[] | undefined;
					const apply = async () => {
						if (result) return result;
						applyConcurrentPatch();
						const updated = templateMatches(predicate);
						if (updated) state.template = { ...state.template, ...values };
						result = updated ? [{ id: templateId }] : [];
						state.updateResults.push(result);
						return result;
					};
					return Object.assign(Promise.resolve().then(apply), { returning: apply });
				},
			};
			return update;
		},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => undefined,
		logApiError: (...args: unknown[]) => {
			state.loggedErrors.push(args);
		},
		withCronLogging: <T>(_name: string, handler: T) => handler,
	},
});
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async (event: unknown) => {
			state.events.push(event);
		},
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async (notification: unknown) => {
			state.notifications.push(notification);
			return { warning: null };
		},
	},
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: {
		hasCapturingExpensePayment: async () => state.capturing,
		withExpensePaymentLock: async (_id: string, operation: (tx: typeof transaction) => unknown) => {
			applyPatchBeforeLock();
			return operation(transaction);
		},
	},
});

const { GET } = await import('./route');

const iso = (value: Date | null | undefined) => value?.toISOString();

test('recurring charge waits for PayPal capture and advances on retry', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const { state, get } = harness();
	const dueAtBeforeCapture = iso(state.template.nextDueAt);
	state.capturing = true;
	const blocked = await get();
	assert.equal(blocked.status, 200);
	assert.equal(state.expenses.length, 0);
	assert.equal(iso(state.template.nextDueAt), dueAtBeforeCapture);
	state.capturing = false;
	const retried = await get();
	assert.equal(retried.status, 200);
	assert.equal(state.expenses.length, 1);
});

test('a concurrent schedule edit wins while the inserted charge is still notified and counted', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const { get } = harness();
	const response = await get();
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true, charged: 1, failedTemplates: 0 });
	assert.equal(state.expenses.length, 1);
	assert.equal(state.splits.length, 1);
	assert.equal(state.notifications.length, 1);
	assert.equal(state.events.length, 1);
	assert.equal(iso(state.template.nextDueAt), iso(editedDueAt));
	assert.equal(iso(state.template.anchorAt), iso(editedDueAt));
	assert.deepEqual(state.updateResults, [[]]);

	const retry = await get();
	assert.deepEqual(await retry.json(), { ok: true, charged: 0 });
	assert.equal(state.expenses.length, 1);
	assert.equal(state.notifications.length, 1);
});

test('a concurrent interval edit is preserved and the idempotent retry uses it', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const { get } = harness({ patchIntervalMonths: true });
	const response = await get();
	assert.deepEqual(await response.json(), { ok: true, charged: 1, failedTemplates: 0 });
	assert.equal(state.template.intervalMonths, 3);
	assert.equal(iso(state.template.nextDueAt), iso(originalDueAt));
	assert.equal(iso(state.template.anchorAt), iso(originalDueAt));
	assert.deepEqual(state.updateResults, [[]]);
	assert.equal(state.expenses.length, 1);
	assert.equal(state.notifications.length, 1);

	const retry = await get();
	assert.deepEqual(await retry.json(), { ok: true, charged: 0, failedTemplates: 0 });
	assert.equal(iso(state.template.nextDueAt), '2026-12-01T00:00:00.000Z');
	assert.deepEqual(state.updateResults, [[], [{ id: templateId }]]);
	assert.equal(state.expenses.length, 1);
	assert.equal(state.notifications.length, 1);
});

test('a pause committed before the locked template read prevents the charge', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const { get } = harness({ patchBeforeLock: 'pause', patchAfterInsert: null });
	const response = await get();
	assert.deepEqual(await response.json(), { ok: true, charged: 0, failedTemplates: 0 });
	assert.equal(iso(state.template.pausedAt), '2026-09-20T00:00:00.000Z');
	assert.equal(state.lockReads, 1);
	assert.equal(state.expenses.length, 0);
	assert.equal(state.notifications.length, 0);
	assert.equal(state.events.length, 0);
	assert.deepEqual(state.updateResults, []);
});

test('a content edit committed before the locked read defers a stale charge', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const { get } = harness({ patchBeforeLock: 'amount', patchAfterInsert: null });
	const response = await get();
	assert.deepEqual(await response.json(), { ok: true, charged: 0, failedTemplates: 0 });
	assert.equal(state.template.amountCents, 600);
	assert.equal(state.lockReads, 1);
	assert.equal(state.expenses.length, 0);
	assert.equal(state.notifications.length, 0);
	assert.deepEqual(state.updateResults, []);
});

test('catch-up charges keep comparing against the initially loaded nextDueAt', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const { get } = harness({
		initialDueAt: new Date('2026-07-01T00:00:00.000Z'),
		patchAfterInsert: null,
	});
	const response = await get();
	assert.deepEqual(await response.json(), { ok: true, charged: 3, failedTemplates: 0 });
	assert.equal(state.lockReads, 3);
	assert.deepEqual(
		state.expenses.map((expense) => iso(expense.recurringDueAt)),
		['2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
	);
	assert.equal(iso(state.template.nextDueAt), '2026-10-01T00:00:00.000Z');
	assert.equal(state.notifications.length, 3);
});

test('an unrelated unique violation is logged and does not advance the template', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const { get } = harness({
		patchAfterInsert: null,
		errorConstraint: 'expenses_import_duplicate_key_unique_idx',
	});
	const response = await get();
	assert.deepEqual(await response.json(), { ok: true, charged: 0, failedTemplates: 0 });
	assert.equal(state.loggedErrors.length, 1);
	assert.equal(state.expenses.length, 0);
	assert.equal(iso(state.template.nextDueAt), iso(originalDueAt));
	assert.deepEqual(state.updateResults, []);
	assert.equal(state.notifications.length, 0);
});

test('a direct recurring-index violation remains an idempotent advance', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const { get } = harness({ patchAfterInsert: null, duplicateErrorShape: 'direct' });
	state.expenses.push({ recurringExpenseId: templateId, recurringDueAt: originalDueAt });
	const response = await get();
	assert.deepEqual(await response.json(), { ok: true, charged: 0, failedTemplates: 0 });
	assert.equal(iso(state.template.nextDueAt), '2026-10-01T00:00:00.000Z');
	assert.deepEqual(state.updateResults, [[{ id: templateId }]]);
	assert.equal(state.expenses.length, 1);
	assert.equal(state.notifications.length, 0);
	assert.equal(state.loggedErrors.length, 0);
});

test('Cron locks the WG before the recurring row and skips when the WG disappeared', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const liveWg = harness({ patchAfterInsert: null });
	const live = await liveWg.get();
	assert.deepEqual(await live.json(), { ok: true, charged: 1, failedTemplates: 0 });
	assert.deepEqual(liveWg.state.lockOrder, ['wgs:key share', 'recurringExpenses:update']);

	const deletedWg = harness({ patchBeforeLock: 'deleteWg', patchAfterInsert: null });
	const deleted = await deletedWg.get();
	assert.deepEqual(await deleted.json(), { ok: true, charged: 0, failedTemplates: 0 });
	assert.deepEqual(deletedWg.state.lockOrder, ['wgs:key share']);
	assert.equal(deletedWg.state.lockReads, 0);
	assert.equal(deletedWg.state.expenses.length, 0);
	assert.deepEqual(deletedWg.state.updateResults, []);
});

test('legacy month-end anchor survives separate January and February cron runs', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2025-01-31T12:00:00.000Z') });
	const legacy = harness({
		initialDueAt: new Date('2025-01-31T00:00:00.000Z'),
		initialAnchorAt: null,
		patchAfterInsert: null,
	});

	await legacy.get();
	assert.equal(iso(state.template.nextDueAt), '2025-02-28T00:00:00.000Z');

	t.mock.timers.setTime(Date.parse('2025-02-28T12:00:00.000Z'));
	await legacy.get();

	assert.deepEqual(
		state.expenses.map((expense) => iso(expense.recurringDueAt)),
		['2025-01-31T00:00:00.000Z', '2025-02-28T00:00:00.000Z'],
	);
	assert.equal(iso(state.template.nextDueAt), '2025-03-31T00:00:00.000Z');
	assert.equal(iso(state.template.anchorAt), '2025-01-31T00:00:00.000Z');
});

test('legacy month-end anchor adopts the pre-advance due date across three months', async (t) => {
	// Due dates are stored as local noon (inputDateToIso), so the UTC day is the Berlin day.
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-31T12:00:00.000Z') });
	const legacy = harness({
		initialDueAt: new Date('2026-01-31T11:00:00.000Z'),
		initialAnchorAt: null,
		patchAfterInsert: null,
	});

	const runs = [
		['2026-01-31T12:00:00.000Z', '2026-02-28T11:00:00.000Z'],
		['2026-02-28T12:00:00.000Z', '2026-03-31T11:00:00.000Z'],
		['2026-03-31T12:00:00.000Z', '2026-04-30T11:00:00.000Z'],
		['2026-04-30T12:00:00.000Z', '2026-05-31T11:00:00.000Z'],
	] as const;
	for (const [runAt, expectedNext] of runs) {
		t.mock.timers.setTime(Date.parse(runAt));
		await legacy.get();
		assert.equal(iso(state.template.nextDueAt), expectedNext);
		assert.equal(iso(state.template.anchorAt), '2026-01-31T11:00:00.000Z');
		assert.equal(state.template.anchorAt?.getUTCDate(), 31);
	}
	assert.deepEqual(
		state.expenses.map((expense) => iso(expense.recurringDueAt)),
		[
			'2026-01-31T11:00:00.000Z',
			'2026-02-28T11:00:00.000Z',
			'2026-03-31T11:00:00.000Z',
			'2026-04-30T11:00:00.000Z',
		],
	);
});

test('legacy month-end catch-up keeps anchor day 31 within a single run', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-30T12:00:00.000Z') });
	const legacy = harness({
		initialDueAt: new Date('2026-01-31T11:00:00.000Z'),
		initialAnchorAt: null,
		patchAfterInsert: null,
	});

	const response = await legacy.get();
	assert.deepEqual(await response.json(), { ok: true, charged: 4, failedTemplates: 0 });
	assert.deepEqual(
		state.expenses.map((expense) => iso(expense.recurringDueAt)),
		[
			'2026-01-31T11:00:00.000Z',
			'2026-02-28T11:00:00.000Z',
			'2026-03-31T11:00:00.000Z',
			'2026-04-30T11:00:00.000Z',
		],
	);
	assert.equal(iso(state.template.nextDueAt), '2026-05-31T11:00:00.000Z');
	assert.equal(iso(state.template.anchorAt), '2026-01-31T11:00:00.000Z');
});

test('a template with a moved-out payer or debtor is skipped without advancing', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const julyDueAt = new Date('2026-07-01T00:00:00.000Z');
	const { get } = harness({ initialDueAt: julyDueAt, patchAfterInsert: null, activeMemberIds: [] });
	const response = await get();
	assert.deepEqual(await response.json(), { ok: true, charged: 0, failedTemplates: 0 });
	// One check per run: the catch-up loop stops at the first skip.
	assert.deepEqual(state.memberQueries, [[memberId]]);
	assert.equal(state.expenses.length, 0);
	assert.equal(state.splits.length, 0);
	assert.equal(state.notifications.length, 0);
	assert.deepEqual(state.updateResults, []);
	assert.equal(iso(state.template.nextDueAt), iso(julyDueAt));
	assert.equal(state.loggedErrors.length, 1);
});
