import { chainOf, columnRef, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The delete is scoped by both `id` and `wgId` combined with `and`, so both
 * operators are replaced with inspectable markers while the rest of drizzle
 * (needed by the schema module at import time) stays real.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (column: unknown, value: unknown) => ({ eq: [columnRef(column), value] }),
}));

const TEMPLATE_ID = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
const PARAMS = { params: Promise.resolve({ code: 'MTE8PZAT' }) };

describe('recurring-expenses DELETE scope', () => {
	beforeEach(() => {
		resetRouteHarness();
	});

	it('RED BUG-guard: scopes the template lookup and delete to the resolved WG, not every WG', async () => {
		const { DELETE } = await import('./route');
		let lookupWhere: unknown;
		const deleteWhere = vi.fn(() => ({
			returning: vi.fn().mockResolvedValue([{ id: TEMPLATE_ID }]),
		}));
		let call = 0;
		routeDb.select.mockImplementation(() => {
			call += 1;
			if (call === 1) {
				// resolveWg
				return chainOf([{ id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' }]);
			}
			// the template ownership lookup this test is verifying
			return chainOf(
				[
					{
						id: TEMPLATE_ID,
						createdByMemberId: 'member-1',
						description: 'Internet',
						amountCents: 3290,
						intervalMonths: 1,
						nextDueAt: new Date('2026-05-20T10:00:00.000Z'),
					},
				],
				{
					onWhere: (condition) => {
						lookupWhere = condition;
					},
				},
			);
		});
		routeDb.delete.mockReturnValue({ where: deleteWhere });
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava', verified: true },
		});

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'DELETE',
				body: JSON.stringify({ id: TEMPLATE_ID }),
			}),
			PARAMS,
		);

		expect(res.status).toBe(200);
		const expectedCondition = {
			and: [
				{ eq: ['recurring_expenses.id', TEMPLATE_ID] },
				{ eq: ['recurring_expenses.wg_id', 'wg-1'] },
			],
		};
		// A missing WG filter on either query would let a member delete another
		// WG's fixed-cost template just by guessing/leaking its id.
		expect(lookupWhere).toEqual(expectedCondition);
		expect(deleteWhere).toHaveBeenCalledWith(expectedCondition);
	});
});
