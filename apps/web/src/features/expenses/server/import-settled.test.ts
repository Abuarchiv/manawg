import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// findSettledImportIds against a stub executor: the import's rows first, then the completed
// payments. The balance math is the real computeBalances.

const IMPORT_ID = 'import-1';
const startedAt = new Date('2026-10-01T10:00:00Z');

interface Payment {
	fromMemberId: string;
	toMemberId: string;
	amountCents: number;
	currency: string;
	completedAt?: Date;
}
interface Expense {
	createdAt?: Date;
	paidByMemberId: string;
	currency: string;
	occurredAt: string;
	splits: Array<{ debtorMemberId: string; amountCents: number; settledAt: null }>;
}
const state: {
	importRows: Array<{ paidBy: string; debtor: string; amount: number }>;
	otherExpenses: Expense[];
	payments: Payment[];
} = { importRows: [], otherExpenses: [], payments: [] };

function expense(paidByMemberId: string, debtorMemberId: string, amountCents: number): Expense {
	return {
		paidByMemberId,
		currency: 'EUR',
		occurredAt: '2026-10-01T10:00:00.000Z',
		splits: [{ debtorMemberId, amountCents, settledAt: null }],
	};
}

mock.module('@/core/db', {
	namedExports: { expensePayments: {}, expenseSplits: {}, expenses: {}, db: {} },
});
mock.module('@/core/db/transaction', { namedExports: {} });
mock.module('drizzle-orm', {
	namedExports: { and: () => ({}), eq: () => ({}), gte: () => ({}), inArray: () => ({}) },
});
mock.module('./expense-ledger.ts', {
	namedExports: {
		loadLedger: async () => [
			...state.otherExpenses.map((item) => ({
				importId: null,
				createdAt: item.createdAt ?? new Date('2026-09-01T00:00:00Z'),
				debt: item,
			})),
			...state.importRows.map((row) => ({
				importId: IMPORT_ID,
				createdAt: new Date('2026-10-01T10:00:00Z'),
				debt: expense(row.paidBy, row.debtor, row.amount),
			})),
		],
	},
});

const { findSettledImportIds } = await import('./import-settled');

const executor = {
	select: () => ({
		from: () => ({
			leftJoin: () => ({
				where: async () =>
					state.importRows.map((row) => ({
						importId: IMPORT_ID,
						paidBy: row.paidBy,
						currency: 'EUR',
						debtor: row.debtor,
						settledAt: null,
					})),
			}),
			where: async () =>
				state.payments.map((payment) => ({
					from: payment.fromMemberId,
					to: payment.toMemberId,
					amountCents: payment.amountCents,
					currency: 'EUR',
					completedAt: payment.completedAt ?? new Date('2026-10-02T10:00:00Z'),
				})),
		}),
	}),
};

async function isSettled(): Promise<boolean> {
	const settled = await findSettledImportIds(executor as never, 'wg-1', [
		{ id: IMPORT_ID, startedAt },
	]);
	return settled.has(IMPORT_ID);
}

test('a payment that closes a circle through the import counts as settling it', async () => {
	// B owes A 1 (import), A owes C 1, C owes B 2; C pays B 1 and the circle cancels.
	state.importRows = [{ paidBy: 'A', debtor: 'B', amount: 100 }];
	state.otherExpenses = [expense('C', 'A', 100), expense('B', 'C', 200)];
	state.payments = [{ fromMemberId: 'C', toMemberId: 'B', amountCents: 100, currency: 'EUR' }];
	assert.equal(await isSettled(), true);
});

test('an import that closes a circle of expenses is settled once any payment follows', async () => {
	// B owes A 10 (import), A owes C 10, C owes B 10 cancel out; undo would bring back A→C and C→B.
	state.importRows = [{ paidBy: 'A', debtor: 'B', amount: 1000 }];
	state.otherExpenses = [expense('C', 'A', 1000), expense('B', 'C', 1000)];
	state.payments = [{ fromMemberId: 'D', toMemberId: 'E', amountCents: 100, currency: 'EUR' }];
	assert.equal(await isSettled(), true);
});

test('a payment between other members that leaves the import untouched does not block undo', async () => {
	state.importRows = [{ paidBy: 'A', debtor: 'B', amount: 100 }];
	state.otherExpenses = [expense('D', 'C', 500)];
	state.payments = [{ fromMemberId: 'C', toMemberId: 'D', amountCents: 200, currency: 'EUR' }];
	assert.equal(await isSettled(), false);
});

test('a payment from before the import is not counted against it', async () => {
	// C owes B 1 (import); an older C→B payment (its expense was deleted) is offset by the import.
	state.importRows = [{ paidBy: 'B', debtor: 'C', amount: 100 }];
	state.otherExpenses = [];
	state.payments = [
		{
			fromMemberId: 'C',
			toMemberId: 'B',
			amountCents: 100,
			currency: 'EUR',
			completedAt: new Date('2026-09-01T10:00:00Z'),
		},
		{ fromMemberId: 'E', toMemberId: 'F', amountCents: 50, currency: 'EUR' },
	];
	assert.equal(await isSettled(), false);
});

test('a payment of the imported debt itself counts as settling it', async () => {
	state.importRows = [{ paidBy: 'A', debtor: 'B', amount: 100 }];
	state.otherExpenses = [];
	state.payments = [{ fromMemberId: 'B', toMemberId: 'A', amountCents: 100, currency: 'EUR' }];
	assert.equal(await isSettled(), true);
});

test('a payment that another debt of the same debtor fully backs does not block undo', async () => {
	// B owes A 1 (import) and C 5; B pays C 2, which the remaining 3 of the C debt backs.
	state.importRows = [{ paidBy: 'A', debtor: 'B', amount: 100 }];
	state.otherExpenses = [expense('C', 'B', 500)];
	state.payments = [{ fromMemberId: 'B', toMemberId: 'C', amountCents: 200, currency: 'EUR' }];
	assert.equal(await isSettled(), false);
});

test('a later purchase does not undo the evidence of an earlier payment', async () => {
	// B owes A 1 (import) and pays it; a new B→A purchase of 1 booked afterwards must not
	// make the payment look like it paid the newer purchase.
	state.importRows = [{ paidBy: 'A', debtor: 'B', amount: 100 }];
	state.otherExpenses = [
		{ ...expense('A', 'B', 100), createdAt: new Date('2026-10-05T10:00:00Z') },
	];
	state.payments = [{ fromMemberId: 'B', toMemberId: 'A', amountCents: 100, currency: 'EUR' }];
	assert.equal(await isSettled(), true);
});

test('an unrelated later payment does not erase an earlier settlement', async () => {
	// The import B→A 1 is paid at t1, a new B→A purchase follows at t2, an unrelated C→D payment at t3.
	state.importRows = [{ paidBy: 'A', debtor: 'B', amount: 100 }];
	state.otherExpenses = [
		{ ...expense('A', 'B', 100), createdAt: new Date('2026-10-05T10:00:00Z') },
	];
	state.payments = [
		{ fromMemberId: 'B', toMemberId: 'A', amountCents: 100, currency: 'EUR' },
		{
			fromMemberId: 'C',
			toMemberId: 'D',
			amountCents: 50,
			currency: 'EUR',
			completedAt: new Date('2026-10-07T10:00:00Z'),
		},
	];
	assert.equal(await isSettled(), true);
});

test('a settling payment after many unrelated payments is still found', async () => {
	state.importRows = [{ paidBy: 'A', debtor: 'B', amount: 100 }];
	state.otherExpenses = [];
	state.payments = [
		...Array.from({ length: 60 }, (_, index) => ({
			fromMemberId: 'C',
			toMemberId: 'D',
			amountCents: 10,
			currency: 'EUR',
			completedAt: new Date(Date.UTC(2026, 9, 2, 10, index)),
		})),
		{
			fromMemberId: 'B',
			toMemberId: 'A',
			amountCents: 100,
			currency: 'EUR',
			completedAt: new Date('2026-10-04T10:00:00Z'),
		},
	];
	assert.equal(await isSettled(), true);
});

test('a split settled only after a payment is still open at that payment', async () => {
	// An older B→A split of 1 was settled by hand at t3; at the t1 payment of the import it was open.
	const older = expense('A', 'B', 100);
	older.splits = older.splits.map((split) => ({
		...split,
		settledAt: '2026-10-06T10:00:00.000Z' as unknown as null,
	}));
	state.importRows = [{ paidBy: 'A', debtor: 'B', amount: 100 }];
	state.otherExpenses = [older];
	state.payments = [{ fromMemberId: 'B', toMemberId: 'A', amountCents: 100, currency: 'EUR' }];
	// At t1: open older 1 + import 1, payment 1 leaves 1; without the import 0 left and no new debt.
	assert.equal(await isSettled(), false);
});
