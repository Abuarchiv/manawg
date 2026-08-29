import { columnRef, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The initial lookup joins `expenses` to `wgs` and scopes it by both the
 * expense id and the URL's share code, combined with `and`. Both operators
 * are replaced with inspectable markers while the rest of drizzle (needed by
 * the schema module at import time) stays real.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (column: unknown, value: unknown) => ({ eq: [columnRef(column), value] }),
}));

const EXPENSE_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const SPLIT_ID = '989ac820-58b7-431f-9c65-28721264f333';
const PARAMS = { params: Promise.resolve({ code: 'MTE8PZAT', id: EXPENSE_ID, splitId: SPLIT_ID }) };

describe('expense split settle scope', () => {
	beforeEach(() => {
		resetRouteHarness();
	});

	it("RED BUG-guard: resolves the expense only when it belongs to the URL's WG share code", async () => {
		const { POST } = await import('./route');
		let expenseLookupWhere: unknown;
		routeDb.select
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: (condition: unknown) => {
							expenseLookupWhere = condition;
							return {
								limit: async () => [
									{
										id: EXPENSE_ID,
										wgId: 'wg-1',
										description: 'Internet',
										paidByMemberId: 'member-creditor',
									},
								],
							};
						},
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [
							{
								id: SPLIT_ID,
								debtorMemberId: 'member-debtor',
								expenseId: EXPENSE_ID,
								settledAt: null,
							},
						],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-debtor', name: 'Ben', verified: true },
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: SPLIT_ID, settledAt: new Date() }],
				}),
			}),
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/expenses/${EXPENSE_ID}/splits/${SPLIT_ID}/settle`,
				{ method: 'POST', body: JSON.stringify({ settled: true }) },
			),
			PARAMS,
		);

		expect(res.status).toBe(200);
		// A missing share-code filter here would let this endpoint resolve and
		// settle a split on an expense id borrowed from a different WG.
		expect(expenseLookupWhere).toEqual({
			and: [{ eq: ['expenses.id', EXPENSE_ID] }, { eq: ['wgs.share_code', 'MTE8PZAT'] }],
		});
	});
});
