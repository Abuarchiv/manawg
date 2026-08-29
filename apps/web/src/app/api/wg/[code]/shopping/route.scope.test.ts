import { chainOf, columnRef, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The clear-bought delete combines `wgId` and `boughtAt is not null` with
 * `and`, so both operators are replaced with inspectable markers while the
 * rest of drizzle (needed by the schema module at import time) stays real.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (column: unknown, value: unknown) => ({ eq: [columnRef(column), value] }),
}));

const PARAMS = { params: Promise.resolve({ code: 'MTE8PZAT' }) };

describe('shopping DELETE scope', () => {
	beforeEach(() => {
		resetRouteHarness();
	});

	it('RED BUG-guard: scopes the bulk clear-bought delete to the resolved WG, not every WG', async () => {
		const { DELETE } = await import('./route');
		const deleteWhere = vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) }));
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.delete.mockReturnValue({ where: deleteWhere });
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava', verified: true },
		});

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/shopping', { method: 'DELETE' }),
			PARAMS,
		);

		expect(res.status).toBe(200);
		// A missing WG filter here would delete every bought item across every
		// WG in the database, not just this one's.
		expect(deleteWhere).toHaveBeenCalledWith({
			and: [
				{ eq: ['shopping_items.wg_id', 'wg-1'] },
				expect.anything(), // isNotNull(boughtAt) — real drizzle SQL, not asserted here
			],
		});
	});
});
