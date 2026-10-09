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
mock.module('./open-expenses.ts', {
	namedExports: {
		loadOpenExpenses: async (
			_wgId: string,
			_client: unknown,
			withoutImportId?: string,
			createdAtOrBefore?: Date,
		) => {
			const all = withoutImportId
				? state.otherExpenses
				: [
						...state.otherExpenses,
						...state.importRows.map((row) => expense(row.paidBy, row.debtor, row.amount)),
					];
			return all.filter(
				(item) =>
					!createdAtOrBefore ||
					!item.createdAt ||
					item.createdAt.getTime() <= createdAtOrBefore.getTime(),
			);
		},
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
