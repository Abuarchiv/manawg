import { wgWriteLimiter } from '@/core/rate-limit';
import {
	queueSelects,
	resetRouteHarness,
	routeDb,
	routeMocks,
	tableNameOf,
} from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This suite asserts both a 200 and a 429 for the same rate limit, so it
// stubs checkRateLimit itself; the harness leaves it real (fail-open) for
// suites that never look at it.
const rateLimitMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock('@/core/rate-limit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/core/rate-limit')>()),
	checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
}));

const SHARE_CODE = 'MTE8PZAT';
const WG_ID = 'wg-1';
const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const WG_ROW = { id: WG_ID, name: 'Küche 4', shareCode: SHARE_CODE };

function authenticate(): void {
	routeMocks.requireMember.mockResolvedValue({
		ok: true,
		member: { memberId: CALLER_ID, name: 'Mina' },
	});
	queueSelects([WG_ROW]);
}

describe('shopping route', () => {
	beforeEach(() => {
		resetRouteHarness();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 9, reset: 0 });
	});

	it('returns field-specific validation errors when creating shopping items', async () => {
		const { POST } = await import('./route');
		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { name: 'Milch', quantity: 'x'.repeat(41) }, error: 'quantity_invalid' },
			{ body: { name: 'Milch', bought: 'yes' }, error: 'bought_invalid' },
		];

		for (const testCase of cases) {
			const res = await POST(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/shopping', {
					method: 'POST',
					body: JSON.stringify(testCase.body),
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: testCase.error });
		}
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('passes the created shopping item id to notifications for deep links', async () => {
		const { POST } = await import('./route');
		const itemId = 'shopping-item-1';
		const announcementValues = vi.fn().mockResolvedValue(undefined);
		authenticate();
		routeDb.insert.mockImplementation((table: unknown) => {
			if (tableNameOf(table) === 'shopping_items') {
				return {
					values: vi.fn(() => ({
						returning: vi.fn().mockResolvedValue([
							{
								id: itemId,
								wgId: WG_ID,
								addedByMemberId: CALLER_ID,
								name: 'Milch',
								quantity: '2x',
								boughtAt: null,
								boughtByMemberId: null,
							},
						]),
					})),
				};
			}
			return {
				values: announcementValues,
			};
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/shopping', {
				method: 'POST',
				headers: { 'x-member-id': CALLER_ID },
				body: JSON.stringify({ name: 'Milch', quantity: '2x' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(routeMocks.dispatchNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ shoppingItemId: itemId }),
			}),
		);
		expect(announcementValues).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'shopping',
				sourcePath: `/einkauf?highlight=${itemId}`,
			}),
		);
	});

	it('returns 429 when creating a shopping item is rate-limited', async () => {
		const { POST } = await import('./route');
		authenticate();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/shopping`, {
				method: 'POST',
				headers: { 'x-member-id': CALLER_ID },
				body: JSON.stringify({ name: 'Milch' }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE }) },
		);

		expect(res.status).toBe(429);
		await expect(res.json()).resolves.toEqual({ error: 'too_many_requests' });
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			wgWriteLimiter,
			`shopping:create:${WG_ID}:${CALLER_ID}`,
		);
		expect(routeDb.insert).not.toHaveBeenCalled();
	});

	it('returns 429 when bulk-clearing bought shopping items is rate-limited', async () => {
		const { DELETE } = await import('./route');
		authenticate();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/shopping`, {
				method: 'DELETE',
				headers: { 'x-member-id': CALLER_ID },
			}),
			{ params: Promise.resolve({ code: SHARE_CODE }) },
		);

		expect(res.status).toBe(429);
		await expect(res.json()).resolves.toEqual({ error: 'too_many_requests' });
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			wgWriteLimiter,
			`shopping:clear-bought:${WG_ID}:${CALLER_ID}`,
		);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('bulk-clears bought shopping items with a WG and member scoped rate-limit key', async () => {
		const { DELETE } = await import('./route');
		const deletedItems = [
			{ id: 'shopping-1', name: 'Milch' },
			{ id: 'shopping-2', name: 'Brot' },
		];
		const returning = vi.fn().mockResolvedValue(deletedItems);
		const where = vi.fn(() => ({ returning }));
		authenticate();
		routeDb.delete.mockReturnValue({ where });

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/shopping`, {
				method: 'DELETE',
				headers: { 'x-member-id': CALLER_ID },
			}),
			{ params: Promise.resolve({ code: SHARE_CODE }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: 2 });
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			wgWriteLimiter,
			`shopping:clear-bought:${WG_ID}:${CALLER_ID}`,
		);
		expect(routeDb.delete).toHaveBeenCalledTimes(1);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				wgId: WG_ID,
				memberId: CALLER_ID,
				eventType: 'shopping.cleared_bought',
				metadata: expect.objectContaining({ count: 2, items: ['Milch', 'Brot'] }),
			}),
		);
	});
});
