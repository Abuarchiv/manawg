import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../../../../../../tests/support/db-mock';
import { mockDrizzle } from '../../../../../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../../../../tests/support/route-harness';

const ids = Array.from(
	{ length: 32 },
	(_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
const [wgId, payerId, debtorId, thirdId, ...expenseIds] = ids as [string, string, string, string];

const expensesTable = {
	id: 'expenses.id',
	wgId: 'expenses.wg_id',
	description: 'expenses.description',
	paidByMemberId: 'expenses.paid_by_member_id',
	currency: 'expenses.currency',
};
const splitsTable = {
	id: 'expense_splits.id',
	expenseId: 'expense_splits.expense_id',
	debtorMemberId: 'expense_splits.debtor_member_id',
	amountCents: 'expense_splits.amount_cents',
	settledAt: 'expense_splits.settled_at',
};
const membersTable = {
	id: 'wg_members.id',
	wgId: 'wg_members.wg_id',
	name: 'wg_members.name',
	color: 'wg_members.color',
};

interface Split {
	id: string;
	expenseId: string;
	debtorMemberId: string;
	amountCents: number;
	settledAt: Date | null;
}
interface Expense {
	id: string;
	wgId: string;
	description: string;
	paidByMemberId: string;
	currency: string;
	splits: [Split];
}
interface Payment {
	fromMemberId: string;
	toMemberId: string;
	amountCents: number;
	currency: string;
}

const expenseId = (index: number) => expenseIds[index] as string;

function entry(
	id: string,
	splitId: string,
	paidByMemberId: string,
	debtorMemberId: string,
	amountCents: number,
	currency = 'EUR',
	settledAt: Date | null = null,
): Expense {
	return {
		id,
		wgId,
		description: `Expense ${id}`,
		paidByMemberId,
		currency,
		splits: [{ id: splitId, expenseId: id, debtorMemberId, amountCents, settledAt }],
	};
}

const current = {
	expenses: [] as Expense[],
	payments: [] as Payment[],
	target: null as unknown as Expense,
	audits: [] as { eventType: string }[],
	updates: [] as unknown[],
	lockActive: false,
};

function rowsFor(table: unknown, join: unknown) {
	const { expenses, target } = current;
	if (table === expensesTable && join === splitsTable) {
		assert.equal(
			current.lockActive,
			true,
			'the global balance snapshot must be read under the payment lock',
		);
		return expenses.flatMap((expense) =>
			expense.splits.map((split) => ({
				expenseId: expense.id,
				paidByMemberId: expense.paidByMemberId,
				currency: expense.currency,
				description: expense.description,
				splitId: split.id,
				debtorMemberId: split.debtorMemberId,
				amountCents: split.amountCents,
				settledAt: split.settledAt,
			})),
		);
	}
	if (table === expensesTable) return expenses.filter((expense) => expense.id === target.id);
	if (table === splitsTable) return target.splits.filter((split) => split.id === target.splits[0].id);
	if (table === membersTable) {
		const memberIds = new Set(
			expenses.flatMap((expense) => [
				expense.paidByMemberId,
				...expense.splits.map((split) => split.debtorMemberId),
			]),
		);
		return [...memberIds].map((id) => ({ id, wgId, name: id, color: null }));
	}
	throw new Error(`Unexpected select table: ${String(table)}`);
}

const db = {
	select() {
		let table: unknown;
		let join: unknown;
		const query = {
			from(value: unknown) {
				table = value;
				return query;
			},
			innerJoin(value: unknown) {
				join = value;
				return query;
			},
			where() {
				const rows = rowsFor(table, join);
				return Object.assign(Promise.resolve(rows), {
					limit: (count: number) => Promise.resolve(rows.slice(0, count)),
				});
			},
		};
		return query;
	},
	update(table: unknown) {
		assert.equal(table, splitsTable);
		return {
			set(values: Partial<Split>) {
				current.updates.push(values);
				return {
					where: () => ({
						returning: async () => {
							const split = current.target.splits[0];
							Object.assign(split, values);
							return [{ ...split }];
						},
					}),
				};
			},
		};
	},
};

mockDrizzle();
mockObservability();
mockRateLimit();
const member = mockWgMember({ wg: { id: wgId }, member: { memberId: debtorId, name: 'Member' } });
mockDb({ db, expenses: expensesTable, expenseSplits: splitsTable, wgMembers: membersTable });
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async (event: { eventType: string }) => {
			current.audits.push(event);
		},
	},
});
mock.module('@/features/expenses/expense-payments', {
	namedExports: {
		hasCapturingExpensePayment: async () => false,
		loadCompletedExpensePayments: async () => current.payments,
		withExpensePaymentLock: async (_wgId: string, run: (handle: typeof db) => unknown) => {
			current.lockActive = true;
			try {
				return await run(db);
			} finally {
				current.lockActive = false;
			}
		},
	},
});

const { POST } = await import('./route');

async function post(options: {
	expenses: Expense[];
	target: Expense;
	payments?: Payment[];
	settled?: boolean;
	rawBody?: string;
}) {
	current.expenses = options.expenses;
	current.payments = options.payments ?? [];
	current.target = options.target;
	current.audits = [];
	current.updates = [];
	member.member = { memberId: debtorId, name: 'Member' };
	const response = await POST(
		request('/api/wg/MTE8PZAT/expenses/x/splits/y/settle', {
			method: 'POST',
			body: options.rawBody ?? { settled: options.settled ?? true },
		}),
		routeCtx({ id: options.target.id, splitId: options.target.splits[0].id }),
	);
	return { response, split: options.target.splits[0] };
}

test('refuses to mark a split settled when a completed payment already covers it', async () => {
	const target = entry(expenseId(0), expenseId(1), payerId, debtorId, 1200);
	const result = await post({
		expenses: [target],
		payments: [{ fromMemberId: debtorId, toMemberId: payerId, amountCents: 1200, currency: 'EUR' }],
		target,
	});

	assert.equal(result.response.status, 409);
	assert.deepEqual(await result.response.json(), { error: 'split_already_offset' });
	assert.equal(result.split.settledAt, null);
	assert.equal(current.updates.length, 0);
	assert.equal(current.audits.length, 0);
});

test('uses all members and blocks a split whose settlement would reverse a network balance', async () => {
	const target = entry(expenseId(0), expenseId(1), payerId, debtorId, 1000);
	const expenses = [
		target,
		entry(expenseId(2), expenseId(3), thirdId, payerId, 1000),
		entry(expenseId(4), expenseId(5), debtorId, thirdId, 1000),
		entry(expenseId(6), expenseId(7), thirdId, debtorId, 1000),
	];
	const result = await post({
		expenses,
		payments: [{ fromMemberId: debtorId, toMemberId: thirdId, amountCents: 1000, currency: 'EUR' }],
		target,
	});

	assert.equal(result.response.status, 409);
	assert.equal(result.split.settledAt, null);
	assert.equal(current.updates.length, 0);
});

test('requires the payer to still have enough creditor balance for the whole split', async () => {
	const target = entry(expenseId(14), expenseId(15), payerId, debtorId, 1000);
	const expenses = [target, entry(expenseId(16), expenseId(17), thirdId, payerId, 500)];
	const result = await post({ expenses, target });

	assert.equal(result.response.status, 409);
	assert.equal(current.updates.length, 0);
});

test('refuses to record the whole split when a completed payment only partly offsets it', async () => {
	const target = entry(expenseId(8), expenseId(9), payerId, debtorId, 1000);
	const result = await post({
		expenses: [target],
		payments: [{ fromMemberId: debtorId, toMemberId: payerId, amountCents: 600, currency: 'EUR' }],
		target,
	});

	assert.equal(result.response.status, 409);
	assert.equal(current.updates.length, 0);
});

test('allows settling an uncredited expense while debtor and payer residuals cover it', async () => {
	const target = entry(expenseId(10), expenseId(11), payerId, debtorId, 1000, 'EUR');
	const result = await post({ expenses: [target], target });

	assert.equal(result.response.status, 200);
	assert.ok(result.split.settledAt);
	assert.equal(current.audits[0]?.eventType, 'expense.split.settled');
});

test('keeps residual balances independent by currency', async () => {
	const target = entry(expenseId(18), expenseId(19), payerId, debtorId, 1000, 'EUR');
	const result = await post({
		expenses: [target],
		payments: [{ fromMemberId: debtorId, toMemberId: payerId, amountCents: 1000, currency: 'USD' }],
		target,
	});

	assert.equal(result.response.status, 200);
	assert.ok(result.split.settledAt);
});

test('allows reopening a manually settled split even when no residual debt remains', async () => {
	const target = entry(
		expenseId(12),
		expenseId(13),
		payerId,
		debtorId,
		1000,
		'EUR',
		new Date('2026-09-01T00:00:00.000Z'),
	);
	const result = await post({ expenses: [target], settled: false, target });

	assert.equal(result.response.status, 200);
	assert.equal(result.split.settledAt, null);
	assert.equal(current.audits[0]?.eventType, 'expense.split.reopened');
});

test('rejects a JSON null body with 400 instead of a 500', async () => {
	const target = entry(expenseId(0), expenseId(1), payerId, debtorId, 1200);
	const result = await post({ expenses: [target], target, rawBody: 'null' });

	assert.equal(result.response.status, 400);
	assert.deepEqual(await result.response.json(), { error: 'invalid_body' });
	assert.equal(current.updates.length, 0);
});
