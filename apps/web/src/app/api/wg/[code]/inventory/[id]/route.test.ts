import { columnRef, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SHARE_CODE = 'MTE8PZAT';
const ITEM_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const MEMBER_ID = '492a85d5-3232-4faf-a2dc-552165aa4dec';
const WG_ID = 'wg-1';

function mockResolveWg(): void {
	routeDb.select.mockReturnValueOnce({
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn().mockResolvedValue([{ id: WG_ID }]),
			})),
		})),
	});
}

function mockLoadItem(item: Record<string, unknown>): void {
	routeDb.select.mockReturnValueOnce({
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn().mockResolvedValue([item]),
			})),
		})),
	});
}

/**
 * This suite asserts that the quantity update guards on the value just read,
 * so those operators need to be inspectable; the rest of drizzle stays real.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (column: unknown, value: unknown) => ({ eq: [columnRef(column), value] }),
}));

describe('inventory item PATCH', () => {
	beforeEach(() => {
		resetRouteHarness();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: MEMBER_ID, name: 'Mina' },
		});
	});

	it('rejects an empty update body', async () => {
		const { PATCH } = await import('./route');
		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}`, {
				method: 'PATCH',
				body: JSON.stringify({}),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'empty_update' });
	});

	it('RED BUG-380: rejects unrealistic quantity deltas instead of silently clamping them', async () => {
		const { PATCH } = await import('./route');

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}`, {
				method: 'PATCH',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ quantityDelta: 999_999_999 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'quantity_invalid' });
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('clamps the quantity at zero and logs a consume entry', async () => {
		const { PATCH } = await import('./route');
		mockResolveWg();
		mockLoadItem({
			id: ITEM_ID,
			wgId: WG_ID,
			name: 'Klopapier',
			quantity: 1,
			unit: 'Rolle',
			threshold: 2,
			category: 'bad',
		});
		const updateSet = vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn().mockResolvedValue([
					{
						id: ITEM_ID,
						wgId: WG_ID,
						name: 'Klopapier',
						quantity: 0,
						unit: 'Rolle',
						threshold: 2,
						category: 'bad',
					},
				]),
			})),
		}));
		routeDb.update.mockReturnValue({ set: updateSet });
		const insertValues = vi.fn().mockResolvedValue(undefined);
		routeDb.insert.mockReturnValue({ values: insertValues });

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}`, {
				method: 'PATCH',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ quantityDelta: -5 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(200);
		const firstCall = updateSet.mock.calls[0] as unknown as Array<{ quantity?: number }>;
		expect(firstCall?.[0]?.quantity).toBe(0);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ delta: -1, kind: 'consume' }),
		);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'inventory.updated' }),
		);
	});

	it('logs a restock entry when delta is positive', async () => {
		const { PATCH } = await import('./route');
		mockResolveWg();
		mockLoadItem({
			id: ITEM_ID,
			wgId: WG_ID,
			name: 'Nudeln',
			quantity: 2,
			unit: 'Packung',
			threshold: 1,
			category: 'kueche',
		});
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi
						.fn()
						.mockResolvedValue([{ id: ITEM_ID, wgId: WG_ID, name: 'Nudeln', quantity: 5 }]),
				})),
			})),
		});
		const insertValues = vi.fn().mockResolvedValue(undefined);
		routeDb.insert.mockReturnValue({ values: insertValues });

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}`, {
				method: 'PATCH',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ quantityDelta: 3 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(200);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ delta: 3, kind: 'restock' }),
		);
	});

	it('RED BUG-022: guards quantityDelta updates with the previously read quantity', async () => {
		const { PATCH } = await import('./route');
		mockResolveWg();
		mockLoadItem({
			id: ITEM_ID,
			wgId: WG_ID,
			name: 'Nudeln',
			quantity: 4,
			unit: 'Packung',
			threshold: 1,
			category: 'kueche',
		});
		const updateWhere = vi.fn(() => ({
			returning: vi
				.fn()
				.mockResolvedValue([{ id: ITEM_ID, wgId: WG_ID, name: 'Nudeln', quantity: 3 }]),
		}));
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: updateWhere,
			})),
		});
		routeDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}`, {
				method: 'PATCH',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ quantityDelta: -1 }),
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

	it('returns 404 when the item does not exist', async () => {
		const { PATCH } = await import('./route');
		mockResolveWg();
		routeDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([]),
				})),
			})),
		});
		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}`, {
				method: 'PATCH',
				headers: { 'x-manawg-member-id': MEMBER_ID },
				body: JSON.stringify({ threshold: 4 }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);
		expect(res.status).toBe(404);
	});
});

describe('inventory item DELETE', () => {
	beforeEach(() => {
		resetRouteHarness();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: MEMBER_ID, name: 'Mina' },
		});
	});

	it('removes the item and records an audit event', async () => {
		const { DELETE } = await import('./route');
		mockResolveWg();
		const returning = vi.fn().mockResolvedValue([{ id: ITEM_ID, name: 'Klopapier' }]);
		routeDb.delete.mockReturnValue({
			where: vi.fn(() => ({ returning })),
		});

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory/${ITEM_ID}`, {
				method: 'DELETE',
				headers: { 'x-manawg-member-id': MEMBER_ID },
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: ITEM_ID }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: true });
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'inventory.deleted' }),
		);
	});
});
