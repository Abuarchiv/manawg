import { expect, test } from '@playwright/test';
import {
	type SettlementExpenseInput,
	type SettlementMemberInput,
	parseSettlementConfirmation,
	selectSettlementScope,
	settlementScopeMatches,
} from '../src/features/expenses/settlement-scope';

const memberA = '11111111-1111-4111-8111-111111111111';
const memberB = '22222222-2222-4222-8222-222222222222';
const memberC = '33333333-3333-4333-8333-333333333333';
const noHttpBaseUrl = 'https://example.invalid';
const fixtureMemberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

const members: SettlementMemberInput[] = [
	{ id: memberA, name: 'Anna', color: null },
	{ id: memberB, name: 'Ben', color: null },
	{ id: memberC, name: 'Cem', color: null },
];

function expense(
	id: string,
	paidByMemberId: string,
	occurredAt: string,
	debtors: Array<{ id: string; amountCents: number }>,
): SettlementExpenseInput {
	return {
		id,
		paidByMemberId,
		occurredAt,
		splits: debtors.map(({ id: debtorMemberId, amountCents }) => ({
			id: `${id}-split-${debtorMemberId.slice(0, 4)}`,
			expenseId: id,
			debtorMemberId,
			amountCents,
			settledAt: null,
		})),
	};
}

test.describe('Settlement scope', () => {
	test('selects every exact direct split oldest first and ignores other pairs', () => {
		const actual = selectSettlementScope(
			[
				expense('expense-old', memberA, '2026-09-01T10:00:00.000Z', [
					{ id: memberB, amountCents: 700 },
				]),
				expense('expense-new', memberA, '2026-09-02T10:00:00.000Z', [
					{ id: memberB, amountCents: 500 },
				]),
				expense('expense-other-pair', memberC, '2026-09-03T10:00:00.000Z', [
					{ id: memberB, amountCents: 900 },
				]),
			],
			members,
			[],
			memberB,
			memberA,
		);

		expect(actual).toEqual({
			netCents: 1200,
			settleableCents: 1200,
			remainingCents: 0,
			splits: [
				{ id: 'expense-old-split-2222', expenseId: 'expense-old', amountCents: 700 },
				{ id: 'expense-new-split-2222', expenseId: 'expense-new', amountCents: 500 },
			],
		});
	});

	test('reports a partial scope when net debt exceeds whole direct splits', () => {
		const actual = selectSettlementScope(
			[
				expense('expense-direct', memberA, '2026-09-01T10:00:00.000Z', [
					{ id: memberB, amountCents: 1000 },
				]),
				expense('expense-through-cem', memberC, '2026-09-02T10:00:00.000Z', [
					{ id: memberB, amountCents: 500 },
				]),
				expense('expense-cem-to-anna', memberA, '2026-09-03T10:00:00.000Z', [
					{ id: memberC, amountCents: 1000 },
				]),
			],
			members,
			[],
			memberB,
			memberA,
		);

		expect(actual).toEqual({
			netCents: 1500,
			settleableCents: 1000,
			remainingCents: 500,
			splits: [{ id: 'expense-direct-split-2222', expenseId: 'expense-direct', amountCents: 1000 }],
		});
	});

	test('caps a 51-split scope and selects the remaining split on the follow-up', () => {
		const expenses = Array.from({ length: 51 }, (_, index) =>
			expense(`expense-${String(index).padStart(2, '0')}`, memberA, '2026-09-01T10:00:00.000Z', [
				{ id: memberB, amountCents: 1 },
			]),
		);

		const firstScope = selectSettlementScope(expenses, members, [], memberB, memberA);

		expect(firstScope.splits).toHaveLength(50);
		expect(firstScope.settleableCents).toBe(50);
		expect(firstScope.remainingCents).toBe(1);

		const firstSplitIds = new Set(firstScope.splits.map((split) => split.id));
		const followUpScope = selectSettlementScope(
			expenses.map((currentExpense) => ({
				...currentExpense,
				splits: currentExpense.splits.map((split) => ({
					...split,
					settledAt: firstSplitIds.has(split.id) ? '2026-09-02T10:00:00.000Z' : split.settledAt,
				})),
			})),
			members,
			[],
			memberB,
			memberA,
		);

		expect(followUpScope).toEqual({
			netCents: 1,
			settleableCents: 1,
			remainingCents: 0,
			splits: [{ id: 'expense-50-split-2222', expenseId: 'expense-50', amountCents: 1 }],
		});
	});

	test('reports a net-only debt when no direct split exists', () => {
		const actual = selectSettlementScope(
			[
				expense('expense-ben-to-cem', memberC, '2026-09-01T10:00:00.000Z', [
					{ id: memberB, amountCents: 1000 },
				]),
				expense('expense-cem-to-anna', memberA, '2026-09-02T10:00:00.000Z', [
					{ id: memberC, amountCents: 1000 },
				]),
			],
			members,
			[],
			memberB,
			memberA,
		);

		expect(actual).toEqual({
			netCents: 1000,
			settleableCents: 0,
			remainingCents: 1000,
			splits: [],
			reason: 'no_direct_splits',
		});
	});

	test('rejects stale net, record ids, and record amounts', () => {
		const actual = selectSettlementScope(
			[
				expense('expense-old', memberA, '2026-09-01T10:00:00.000Z', [
					{ id: memberB, amountCents: 700 },
				]),
				expense('expense-new', memberA, '2026-09-02T10:00:00.000Z', [
					{ id: memberB, amountCents: 500 },
				]),
				expense('expense-other-pair', memberC, '2026-09-03T10:00:00.000Z', [
					{ id: memberB, amountCents: 900 },
				]),
			],
			members,
			[],
			memberB,
			memberA,
		);
		const reviewed = {
			netCents: 1200,
			settleableCents: 1200,
			splits: [
				{ id: 'expense-old-split-2222', amountCents: 700 },
				{ id: 'expense-new-split-2222', amountCents: 500 },
			],
		};

		expect(settlementScopeMatches(reviewed, actual)).toBe(true);
		expect(settlementScopeMatches({ ...reviewed, netCents: 1100 }, actual)).toBe(false);
		expect(
			settlementScopeMatches(
				{
					...reviewed,
					splits: [
						{ id: 'different-split', amountCents: 700 },
						{ id: 'expense-new-split-2222', amountCents: 500 },
					],
				},
				actual,
			),
		).toBe(false);
		expect(
			settlementScopeMatches(
				{
					...reviewed,
					splits: [
						{ id: 'expense-old-split-2222', amountCents: 600 },
						{ id: 'expense-new-split-2222', amountCents: 600 },
					],
				},
				actual,
			),
		).toBe(false);
	});

	test('requires a complete strict review and rejects duplicate or invalid records', () => {
		const validReview = {
			fromMemberId: memberB,
			toMemberId: memberA,
			expected: {
				netCents: 1000,
				settleableCents: 1000,
				splits: [{ id: '44444444-4444-4444-8444-444444444444', amountCents: 1000 }],
			},
		};
		expect(parseSettlementConfirmation(validReview)).toEqual({ ok: true, value: validReview });

		expect(parseSettlementConfirmation({ fromMemberId: memberB, toMemberId: memberA })).toEqual({
			ok: false,
			reason: 'required',
		});

		expect(
			parseSettlementConfirmation({
				fromMemberId: memberB,
				toMemberId: memberA,
				expected: {
					netCents: 1000,
					settleableCents: 1000,
					splits: [
						{ id: '44444444-4444-4444-8444-444444444444', amountCents: 500 },
						{ id: '44444444-4444-4444-8444-444444444444', amountCents: 500 },
					],
				},
			}),
		).toEqual({ ok: false, reason: 'invalid' });

		expect(
			parseSettlementConfirmation({
				fromMemberId: memberB,
				toMemberId: memberA,
				expected: {
					netCents: 1000,
					settleableCents: 500,
					splits: [{ id: '44444444-4444-4444-8444-444444444444', amountCents: -1 }],
				},
			}),
		).toEqual({ ok: false, reason: 'invalid' });

		expect(
			parseSettlementConfirmation({
				fromMemberId: memberB,
				toMemberId: memberA,
				expected: {
					netCents: 1000,
					settleableCents: 1000,
					splits: [],
				},
				extra: 'not-supported',
			}),
		).toEqual({ ok: false, reason: 'invalid' });
	});
});

test.describe('Settlement HTTP cache policy', () => {
	test.skip(
		process.env.BASE_URL === noHttpBaseUrl,
		'HTTP checks are intentionally skipped for the no-network pure-test run',
	);

	test('sets no-store on an invalid share-code preamble response', async ({ request }) => {
		const response = await request.get(
			`/api/wg/not-a-code/expenses/settle-batch?fromMemberId=${memberA}&toMemberId=${memberB}`,
		);

		expect(response.status()).toBe(400);
		expect(response.headers()['cache-control']).toBe('no-store');
		await expect(response.json()).resolves.toMatchObject({ error: 'invalid_share_code' });
	});

	test('sets no-store on a withWgRoute caught-error response', async ({ request }) => {
		test.skip(
			process.env.CI !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
			'the caught-error case requires the local DB-down fixture server',
		);

		const response = await request.get(
			`/api/wg/MTE8PZAT/expenses/settle-batch?fromMemberId=${memberA}&toMemberId=${memberB}`,
			{ headers: { 'x-manawg-member-id': fixtureMemberId } },
		);

		expect(response.status()).toBe(500);
		expect(response.headers()['cache-control']).toBe('no-store');
		await expect(response.json()).resolves.toMatchObject({ error: 'server_error' });
	});
});
