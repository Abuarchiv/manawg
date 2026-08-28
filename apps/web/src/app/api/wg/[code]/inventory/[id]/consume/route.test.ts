import { shoppingItems } from '@/lib/db';
import {
	columnRef,
	resetRouteHarness,
	routeDb,
	routeMocks,
	tableNameOf,
} from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 9, reset: 0 }),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: {},
	};
});

const SHARE_CODE = 'MTE8PZAT';
const ITEM_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const MEMBER_ID = '492a85d5-3232-4faf-a2dc-552165aa4dec';
const WG_ID = 'wg-1';

interface InventoryRow {
	id: string;
	wgId: string;
	name: string;
	quantity: number;
	unit: string;
	threshold: number;
	category: string;
	lastDecrementedAt: Date | null;
}

function defaultInventory(overrides: Partial<InventoryRow> = {}): InventoryRow {
	return {
		id: ITEM_ID,
		wgId: WG_ID,
		name: 'Klopapier',
		quantity: 4,
		unit: 'Rolle',
		threshold: 2,
		category: 'bad',
		lastDecrementedAt: null,
		...overrides,
	};
}

function setupSelectQueue(responses: unknown[][]): void {
	let index = 0;
	routeDb.select.mockImplementation(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn().mockResolvedValue(responses[index++] ?? []),
			})),
		})),
	}));
}

function setupSelectMixed(responses: Array<() => unknown>): void {
	let index = 0;
	routeDb.select.mockImplementation(() => {
		const factory = responses[index++];
		return factory ? factory() : { from: vi.fn() };
	});
}

/**
 * Two tests here assert *how* a write is scoped — that the quantity update
 * guards on the value just read, and that the shopping-item upsert targets a
 * real DB constraint. Those need the operators inspectable; the rest of
 * drizzle stays real so the schema module still imports.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (column: unknown, value: unknown) => ({ eq: [columnRef(column), value] }),
}));

describe('inventory consume route', () => {
	beforeEach(() => {
		resetRouteHarness();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: MEMBER_ID, name: 'Mina' },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 9, reset: 0 });
		routeMocks.dispatchNotification.mockResolvedValue(undefined);
	});

	it('rejects positive deltas', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}/consume`, {
				method: 'POST',
				body: JSON.stringify({ delta: 1 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'delta_invalid' });
	});

	it('decrements quantity, clamps at zero, and auto-pushes to shopping list', async () => {
		const { POST } = await import('./route');
		const inventory = defaultInventory({ quantity: 1, threshold: 2 });

		setupSelectMixed([
			// resolveWg
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi
							.fn()
							.mockResolvedValue([{ id: WG_ID, name: 'Test WG', shareCode: SHARE_CODE }]),
					})),
				})),
			}),
			// load inventory
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([inventory]),
					})),
				})),
			}),
			// open shopping items (none match)
			() => ({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([{ id: 'sh-other', name: 'Milch' }]),
				})),
			}),
		]);

		const updateReturning = vi.fn().mockResolvedValue([
			{
				...inventory,
				quantity: 0,
				lastDecrementedAt: new Date(),
			},
		]);
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({ returning: updateReturning })),
			})),
		});

		const logInsertValues = vi.fn().mockResolvedValue(undefined);
		const shoppingInsertReturning = vi.fn().mockResolvedValue([{ id: 'sh-new' }]);
		const shoppingInsertValues = vi.fn(() => ({
			onConflictDoNothing: vi.fn(() => ({ returning: shoppingInsertReturning })),
		}));
		let insertCall = 0;
		routeDb.insert.mockImplementation((table: { id?: string }) => {
			insertCall += 1;
			if (tableNameOf(table) === 'wg_inventory_log' || insertCall === 1) {
				return { values: logInsertValues };
			}
			return { values: shoppingInsertValues };
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}/consume`, {
				method: 'POST',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ delta: -5 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			clamped: boolean;
			autoPushedShoppingItemId: string | null;
		};
		expect(body.clamped).toBe(true);
		expect(body.autoPushedShoppingItemId).toBe('sh-new');
		expect(shoppingInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Klopapier' }),
		);
		expect(routeMocks.dispatchNotification).toHaveBeenCalled();
	});

	it('does not push to shopping when a matching open item already exists', async () => {
		const { POST } = await import('./route');
		const inventory = defaultInventory({ quantity: 2, threshold: 2 });

		setupSelectMixed([
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi
							.fn()
							.mockResolvedValue([{ id: WG_ID, name: 'Test WG', shareCode: SHARE_CODE }]),
					})),
				})),
			}),
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([inventory]),
					})),
				})),
			}),
			() => ({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([{ id: 'sh-existing', name: ' klopapier ' }]),
				})),
			}),
		]);

		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([{ ...inventory, quantity: 1 }]),
				})),
			})),
		});

		const insertSpy = vi.fn().mockResolvedValue(undefined);
		routeDb.insert.mockReturnValue({ values: insertSpy });

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}/consume`, {
				method: 'POST',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ delta: -1 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { autoPushedShoppingItemId: string | null };
		expect(body.autoPushedShoppingItemId).toBeNull();
	});

	it('returns 429 when the consume rate limit is exceeded', async () => {
		const { POST } = await import('./route');
		setupSelectQueue([[{ id: WG_ID, name: 'Test WG', shareCode: SHARE_CODE }]]);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}/consume`, {
				method: 'POST',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ delta: -1 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(429);
	});

	it('RED BUG-022-CONSUME: guards consume updates with the previously read quantity', async () => {
		const { POST } = await import('./route');
		const inventory = defaultInventory({ quantity: 4, threshold: 1 });

		setupSelectMixed([
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi
							.fn()
							.mockResolvedValue([{ id: WG_ID, name: 'Test WG', shareCode: SHARE_CODE }]),
					})),
				})),
			}),
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([inventory]),
					})),
				})),
			}),
		]);

		const updateWhere = vi.fn(() => ({
			returning: vi.fn().mockResolvedValue([{ ...inventory, quantity: 3 }]),
		}));
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: updateWhere,
			})),
		});
		routeDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}/consume`, {
				method: 'POST',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ delta: -1 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(200);
		expect(updateWhere).toHaveBeenCalledWith(
			expect.objectContaining({
				and: expect.arrayContaining([
					expect.objectContaining({ eq: ['wg_inventory_items.quantity', 4] }),
				]),
			}),
		);
	});

	it('RED BUG-563: uses a DB-backed conflict target for auto-pushed shopping items', async () => {
		const { POST } = await import('./route');
		const inventory = defaultInventory({ quantity: 3, threshold: 2 });

		setupSelectMixed([
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi
							.fn()
							.mockResolvedValue([{ id: WG_ID, name: 'Test WG', shareCode: SHARE_CODE }]),
					})),
				})),
			}),
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([inventory]),
					})),
				})),
			}),
			() => ({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([]),
				})),
			}),
		]);

		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([{ ...inventory, quantity: 1 }]),
				})),
			})),
		});

		const logInsertValues = vi.fn().mockResolvedValue(undefined);
		const onConflictDoNothing = vi.fn(() => ({
			returning: vi.fn().mockResolvedValue([{ id: 'sh-new' }]),
		}));
		const shoppingInsertValues = vi.fn(() => ({ onConflictDoNothing }));
		let insertCall = 0;
		routeDb.insert.mockImplementation(() => {
			insertCall += 1;
			if (insertCall === 1) return { values: logInsertValues };
			return { values: shoppingInsertValues };
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}/consume`, {
				method: 'POST',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ delta: -2 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(200);
		expect(onConflictDoNothing).toHaveBeenCalledWith({
			target: [shoppingItems.wgId, shoppingItems.normalizedName],
			// The partial-index predicate itself; this test's claim is about the
			// target columns matching a real constraint.
			where: expect.anything(),
		});
	});

	it('returns 409 when a concurrent write already changed the quantity (version conflict)', async () => {
		const { POST } = await import('./route');
		const inventory = defaultInventory({ quantity: 4, threshold: 1 });

		setupSelectMixed([
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi
							.fn()
							.mockResolvedValue([{ id: WG_ID, name: 'Test WG', shareCode: SHARE_CODE }]),
					})),
				})),
			}),
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([inventory]),
					})),
				})),
			}),
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([{ id: ITEM_ID }]),
					})),
				})),
			}),
		]);

		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([]),
				})),
			})),
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}/consume`, {
				method: 'POST',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ delta: -1 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(409);
	});

	it('returns 404 when the item was deleted between read and write', async () => {
		const { POST } = await import('./route');
		const inventory = defaultInventory({ quantity: 4, threshold: 1 });

		setupSelectMixed([
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi
							.fn()
							.mockResolvedValue([{ id: WG_ID, name: 'Test WG', shareCode: SHARE_CODE }]),
					})),
				})),
			}),
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([inventory]),
					})),
				})),
			}),
			() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([]),
					})),
				})),
			}),
		]);

		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([]),
				})),
			})),
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}/consume`, {
				method: 'POST',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ delta: -1 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(404);
	});
});
