import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const wgId = '11111111-1111-4111-8111-111111111111';
const expenses = {
	id: 'expenses.id',
	wgId: 'expenses.wgId',
	paidByMemberId: 'expenses.paidByMemberId',
	currency: 'expenses.currency',
	occurredAt: 'expenses.occurredAt',
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
		inArray: () => assert.fail('splits must not be loaded by an id list'),
	},
});

const { loadOpenExpenses } = await import('./open-expenses');

test('loadOpenExpenses joins splits by WG instead of binding every expense id', async () => {
	const splitQueries: unknown[] = [];
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
				where: async (predicate: unknown) => {
					if (query.table === expenses) {
						assert.deepEqual(predicate, eq(expenses.wgId, wgId));
						return [
							{
								id: 'e1',
								paidByMemberId: 'a',
								currency: 'EUR',
								occurredAt: new Date('2026-09-01T00:00:00.000Z'),
							},
							{ id: 'e2', paidByMemberId: 'b', currency: null, occurredAt: '2026-09-02' },
						];
					}
					splitQueries.push({ join: query.join, predicate });
					return [
						{ expenseId: 'e1', debtorMemberId: 'b', amountCents: 500, settledAt: null },
						{
							expenseId: 'e2',
							debtorMemberId: 'a',
							amountCents: 300,
							settledAt: new Date('2026-09-03T00:00:00.000Z'),
						},
					];
				},
			};
			return query;
		},
	};

	const result = await loadOpenExpenses(wgId, client as never);

	assert.deepEqual(splitQueries, [
		{
			join: { table: expenses, on: eq(expenseSplits.expenseId, expenses.id) },
			predicate: eq(expenses.wgId, wgId),
		},
	]);
	assert.deepEqual(result, [
		{
			paidByMemberId: 'a',
			currency: 'EUR',
			occurredAt: '2026-09-01T00:00:00.000Z',
			splits: [{ debtorMemberId: 'b', amountCents: 500, settledAt: null }],
		},
		{
			paidByMemberId: 'b',
			occurredAt: '2026-09-02',
			splits: [{ debtorMemberId: 'a', amountCents: 300, settledAt: '2026-09-03T00:00:00.000Z' }],
		},
	]);
});
