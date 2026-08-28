import { beforeEach, describe, expect, it, vi } from 'vitest';

const WG_ID = 'wg-1';
const EXPENSE_A = 'exp-a';
const EXPENSE_B = 'exp-b';
const PAYER_A = 'member-a';
const PAYER_B = 'member-b';
const DEBTOR_A = 'member-c';
const DEBTOR_B = 'member-d';

const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
}));

vi.mock('@/core/db', () => ({
	db: {
		select: (...args: unknown[]) => dbMock.select(...args),
	},
	expenses: {
		id: 'expenses.id',
		occurredAt: 'expenses.occurredAt',
		paidByMemberId: 'expenses.paidByMemberId',
		wgId: 'expenses.wgId',
	},
	expenseSplits: {
		amountCents: 'expenseSplits.amountCents',
		debtorMemberId: 'expenseSplits.debtorMemberId',
		expenseId: 'expenseSplits.expenseId',
		settledAt: 'expenseSplits.settledAt',
	},
}));

vi.mock('drizzle-orm', () => ({
	eq: (...args: unknown[]) => ({ eq: args }),
	inArray: (...args: unknown[]) => ({ inArray: args }),
}));

/** Queue one awaited `.from().where()` result per `db.select()` call, in order. */
function mockSelectResponses(...responses: unknown[][]): void {
	for (const rows of responses) {
		dbMock.select.mockReturnValueOnce({
			from: () => ({ where: async () => rows }),
		});
	}
}

describe('loadOpenExpenses', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns an empty array and skips the splits query when the WG has no expenses', async () => {
		const { loadOpenExpenses } = await import('./open-expenses');
		mockSelectResponses([]);

		const result = await loadOpenExpenses(WG_ID);

		expect(result).toEqual([]);
		expect(dbMock.select).toHaveBeenCalledTimes(1);
	});

	it('normalizes Date values to ISO strings and groups splits by their expense', async () => {
		const { loadOpenExpenses } = await import('./open-expenses');
		mockSelectResponses(
			[
				{
					id: EXPENSE_A,
					paidByMemberId: PAYER_A,
					occurredAt: new Date('2026-07-01T12:00:00.000Z'),
				},
				{
					id: EXPENSE_B,
					paidByMemberId: PAYER_B,
					occurredAt: new Date('2026-07-02T12:00:00.000Z'),
				},
			],
			[
				{
					expenseId: EXPENSE_A,
					debtorMemberId: DEBTOR_A,
					amountCents: 500,
					settledAt: null,
				},
				{
					expenseId: EXPENSE_A,
					debtorMemberId: DEBTOR_B,
					amountCents: 300,
					settledAt: new Date('2026-07-03T00:00:00.000Z'),
				},
			],
		);

		const result = await loadOpenExpenses(WG_ID);

		expect(result).toEqual([
			{
				paidByMemberId: PAYER_A,
				occurredAt: '2026-07-01T12:00:00.000Z',
				splits: [
					{ debtorMemberId: DEBTOR_A, amountCents: 500, settledAt: null },
					{ debtorMemberId: DEBTOR_B, amountCents: 300, settledAt: '2026-07-03T00:00:00.000Z' },
				],
			},
			{
				paidByMemberId: PAYER_B,
				occurredAt: '2026-07-02T12:00:00.000Z',
				// EXPENSE_B has no splits, so it must surface an empty list rather than be dropped.
				splits: [],
			},
		]);
		expect(dbMock.select).toHaveBeenCalledTimes(2);
	});

	it('passes through non-Date occurredAt and settledAt values via String()', async () => {
		const { loadOpenExpenses } = await import('./open-expenses');
		mockSelectResponses(
			[{ id: EXPENSE_A, paidByMemberId: PAYER_A, occurredAt: '2026-07-01' }],
			[
				{
					expenseId: EXPENSE_A,
					debtorMemberId: DEBTOR_A,
					amountCents: 500,
					settledAt: '2026-07-05',
				},
			],
		);

		const result = await loadOpenExpenses(WG_ID);

		expect(result[0]?.occurredAt).toBe('2026-07-01');
		expect(result[0]?.splits[0]?.settledAt).toBe('2026-07-05');
	});
});
