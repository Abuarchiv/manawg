import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const wgId = '11111111-1111-4111-8111-111111111111';
const expenses = {
	id: 'expenses.id',
	wgId: 'expenses.wgId',
	paidByMemberId: 'expenses.paidByMemberId',
	currency: 'expenses.currency',
	occurredAt: 'expenses.occurredAt',
	importId: 'expenses.importId',
	createdAt: 'expenses.createdAt',
};
const expenseSplits = {
	expenseId: 'expenseSplits.expenseId',
	debtorMemberId: 'expenseSplits.debtorMemberId',
	amountCents: 'expenseSplits.amountCents',
	settledAt: 'expenseSplits.settledAt',
};
const eq = (field: unknown, value: unknown) => ({ operator: 'eq', field, value });
mock.module('@/core/db', { namedExports: { db: null, expenseSplits, expenses } });
mock.module('drizzle-orm', {
	namedExports: {
		eq,
		inArray: () => assert.fail('Anteile müssen ohne Liste aller Ausgaben-IDs geladen werden'),
	},
});
const { loadExpensesWithSplits, loadLedger } = await import('./expense-ledger');
const expense = {
	id: 'e1',
	paidByMemberId: 'a',
	currency: 'EUR',
	occurredAt: new Date('2026-09-01T00:00:00.000Z'),
	importId: 'import-1',
	createdAt: new Date('2026-09-01T10:00:00.000Z'),
};
const split = { expenseId: 'e1', debtorMemberId: 'b', amountCents: 500, settledAt: null };
type Expense = Omit<typeof expense, 'currency' | 'occurredAt'> & {
	currency: string | null;
	occurredAt: Date | string;
};
type Split = Omit<typeof split, 'settledAt'> & { settledAt: Date | string | null };

function clientFor(expenseRows: Expense[], splitRows: Split[], afterRead = () => {}) {
	const reads: unknown[] = [];
	const client = {
		select() {
			const query = {
				table: null as unknown,
				join: null as unknown,
				from(table: unknown) {
					query.table = table;
					return query;
				},
				innerJoin(table: unknown, on: unknown) {
					query.join = { table, on };
					return query;
				},
				leftJoin(table: unknown, on: unknown) {
					query.join = { table, on };
					return query;
				},
				where: async (predicate: unknown) => {
					assert.deepEqual(predicate, eq(expenses.wgId, wgId));
					reads.push({ table: query.table, join: query.join });
					let rows: unknown[];
					if (query.table === expenses && query.join) {
						rows = expenseRows.flatMap<{ expense: Expense; split: Split | null }>((row) => {
							const matching = splitRows.filter((entry) => entry.expenseId === row.id);
							return matching.length > 0
								? matching.map((entry) => ({ expense: { ...row }, split: { ...entry } }))
								: [{ expense: { ...row }, split: null }];
						});
					} else {
						rows = (query.table === expenses ? expenseRows : splitRows).map((row) => ({ ...row }));
					}
					afterRead();
					return rows;
				},
			};
			return query;
		},
	};
	return { client, reads };
}

test('the ledger never combines old payers with new shares during a concurrent edit', async () => {
	const currentExpense = { ...expense };
	const currentSplit = { ...split };
	const { client } = clientFor([currentExpense], [currentSplit], () => {
		currentExpense.paidByMemberId = 'b';
		currentSplit.debtorMemberId = 'a';
	});
	const result = await loadExpensesWithSplits(wgId, client as never);
	assert.deepEqual(result, [
		{
			paidByMemberId: 'a',
			currency: 'EUR',
			occurredAt: expense.occurredAt.toISOString(),
			splits: [{ debtorMemberId: 'b', amountCents: 500, settledAt: null }],
		},
	]);
});

test('the ledger keeps all shares, expenses without shares and import data in a flat-scoped snapshot', async () => {
	const settledAt = new Date('2026-09-03T00:00:00.000Z');
	const { client, reads } = clientFor(
		[
			{ ...expense },
			{ ...expense, id: 'e2', paidByMemberId: 'b', currency: null, occurredAt: '2026-09-02' },
		],
		[{ ...split }, { ...split, debtorMemberId: 'c', amountCents: 300, settledAt }],
	);
	const result = await loadLedger(wgId, client as never);
	assert.deepEqual(reads, [
		{
			table: expenses,
			join: { table: expenseSplits, on: eq(expenseSplits.expenseId, expenses.id) },
		},
	]);
	assert.deepEqual(result, [
		{
			importId: expense.importId,
			createdAt: expense.createdAt,
			debt: {
				paidByMemberId: 'a',
				currency: 'EUR',
				occurredAt: expense.occurredAt.toISOString(),
				splits: [
					{ debtorMemberId: 'b', amountCents: 500, settledAt: null },
					{ debtorMemberId: 'c', amountCents: 300, settledAt: settledAt.toISOString() },
				],
			},
		},
		{
			importId: expense.importId,
			createdAt: expense.createdAt,
			debt: { paidByMemberId: 'b', occurredAt: '2026-09-02', splits: [] },
		},
	]);
});

test('an empty ledger stays empty', async () => {
	const { client } = clientFor([], []);
	assert.deepEqual(await loadLedger(wgId, client as never), []);
});
