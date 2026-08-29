import { wgEvents } from '@/core/db';
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

describe('events GET scope', () => {
	beforeEach(() => {
		resetRouteHarness();
	});

	it('scopes the event list query to the resolved WG, not every WG', async () => {
		const { GET } = await import('./route');
		let eventsWhere: unknown;
		let call = 0;
		routeDb.select.mockImplementation(() => {
			call += 1;
			if (call === 1) {
				return chainOf([{ id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' }]);
			}
			if (call === 2) {
				return chainOf([], {
					onWhere: (condition) => {
						eventsWhere = condition;
					},
				});
			}
			return chainOf([]);
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava', verified: true },
		});

		const res = await GET(new NextRequest('https://mana.test/api/wg/MTE8PZAT/events'), PARAMS);

		expect(res.status).toBe(200);
		// No `from`/`to` query params, so the route's window filter is undefined
		// and the WG filter is passed straight through as the where clause.
		expect(eventsWhere).toEqual({ eq: [wgEvents.wgId, 'wg-1'] });
	});
});
