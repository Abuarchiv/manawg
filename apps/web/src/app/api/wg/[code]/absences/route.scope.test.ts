import { chainOf, columnRef, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The list query combines `wgId` and `endDate >= now` with `and`, so both
 * operators are replaced with inspectable markers while the rest of drizzle
 * (needed by the schema module at import time) stays real.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (column: unknown, value: unknown) => ({ eq: [columnRef(column), value] }),
}));

const PARAMS = { params: Promise.resolve({ code: 'MTE8PZAT' }) };

describe('absences GET scope', () => {
	beforeEach(() => {
		resetRouteHarness();
	});

	it('scopes the absence list query to the resolved WG, not every WG', async () => {
		const { GET } = await import('./route');
		let absencesWhere: unknown;
		let call = 0;
		routeDb.select.mockImplementation(() => {
			call += 1;
			if (call === 1) {
				return chainOf([{ id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' }]);
			}
			if (call === 2) {
				return chainOf([], {
					onWhere: (condition) => {
						absencesWhere = condition;
					},
				});
			}
			return chainOf([]);
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava', verified: true },
		});

		const res = await GET(new NextRequest('https://mana.test/api/wg/MTE8PZAT/absences'), PARAMS);

		expect(res.status).toBe(200);
		expect(absencesWhere).toEqual({
			and: [
				{ eq: ['member_absences.wg_id', 'wg-1'] },
				expect.anything(), // gte(endDate, now) — real drizzle SQL, not asserted here
			],
		});
	});
});
