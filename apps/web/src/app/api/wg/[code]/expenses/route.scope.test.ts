import { expenses } from '@/core/db';
import { chainOf, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `eq` is the one operator this suite inspects, so it is replaced with an
 * inspectable marker while the rest of drizzle (needed by the schema module
 * at import time) stays real.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	eq: (...args: unknown[]) => ({ eq: args }),
}));

const PARAMS = { params: Promise.resolve({ code: 'MTE8PZAT' }) };

describe('expenses GET scope', () => {
	beforeEach(() => {
		resetRouteHarness();
	});

	it('RED BUG-guard: scopes the expense list query to the resolved WG, not every expense', async () => {
		const { GET } = await import('./route');
		let expensesWhere: unknown;
		let call = 0;
		routeDb.select.mockImplementation(() => {
			call += 1;
			if (call === 1) {
				// resolveWg: db.select().from(wgs).where(eq(wgs.shareCode, code))
				return chainOf([{ id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' }]);
			}
			if (call === 2) {
				return chainOf(
					[
						{
							id: 'expense-1',
							wgId: 'wg-1',
							description: 'Pizza',
							amountCents: 1250,
						},
					],
					{
						onWhere: (condition) => {
							expensesWhere = condition;
						},
					},
				);
			}
			return chainOf([]);
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava', verified: true },
		});

		const res = await GET(new NextRequest('https://mana.test/api/wg/MTE8PZAT/expenses'), PARAMS);

		expect(res.status).toBe(200);
		// A leaked/removed WG filter here means the endpoint hands back every
		// expense in the database instead of just this WG's.
		expect(expensesWhere).toEqual({ eq: [expenses.wgId, 'wg-1'] });
	});
});
