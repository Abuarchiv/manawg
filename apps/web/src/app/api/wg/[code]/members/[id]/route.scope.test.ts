import { chainOf, columnRef, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The lookup and the update are both scoped by `id` and `wgId` combined with
 * `and`, so both operators are replaced with inspectable markers while the
 * rest of drizzle (needed by the schema module at import time) stays real.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (column: unknown, value: unknown) => ({ eq: [columnRef(column), value] }),
}));

const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const PARAMS = { params: Promise.resolve({ code: 'MTE8PZAT', id: MEMBER_ID }) };

describe('members/[id] PATCH scope', () => {
	beforeEach(() => {
		resetRouteHarness();
	});

	it('RED BUG-guard: scopes the deactivate lookup and update to the resolved WG, not every WG', async () => {
		const { PATCH } = await import('./route');
		let lookupWhere: unknown;
		const updateWhere = vi.fn(() => ({
			returning: async () => [{ id: MEMBER_ID, name: 'Ben', deactivatedAt: new Date() }],
		}));
		let call = 0;
		routeDb.select.mockImplementation(() => {
			call += 1;
			if (call === 1) {
				return chainOf([{ id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' }]);
			}
			return chainOf([{ id: MEMBER_ID, name: 'Ben', deactivatedAt: null }], {
				onWhere: (condition) => {
					lookupWhere = condition;
				},
			});
		});
		routeDb.update.mockReturnValue({
			set: () => ({ where: updateWhere }),
		});
		// The caller deactivates themselves, so isOwner short-circuits the admin
		// check and this test does not also have to stub isVerifiedWgAdmin.
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: MEMBER_ID, name: 'Ben', verified: true },
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/members/${MEMBER_ID}`, {
				method: 'PATCH',
				body: JSON.stringify({ active: false }),
			}),
			PARAMS,
		);

		expect(res.status).toBe(200);
		const expectedCondition = {
			and: [{ eq: ['wg_members.id', MEMBER_ID] }, { eq: ['wg_members.wg_id', 'wg-1'] }],
		};
		// A missing WG filter on either query would let a member deactivate a
		// same-id member row belonging to a different WG.
		expect(lookupWhere).toEqual(expectedCondition);
		expect(updateWhere).toHaveBeenCalledWith(expectedCondition);
	});
});
