import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		clientIpKey: () => 'spoofed-ip',
		wgWriteLimiter: { name: 'wgWriteLimiter' },
	};
});

describe('shopping item route', () => {
	beforeEach(() => {
		resetRouteHarness();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: -1, reset: 0 });
	});

	it('returns a field-specific validation error for invalid bought status updates', async () => {
		const { PATCH } = await import('./route');

		const res = await PATCH(
			new NextRequest(
				'https://mana.test/api/wg/MTE8PZAT/shopping/7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
				{
					method: 'PATCH',
					body: JSON.stringify({ bought: 'yes' }),
				},
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
				}),
			},
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'bought_invalid' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('links bought-item system announcements to the concrete shopping item', async () => {
		const { PATCH } = await import('./route');
		const itemId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const memberId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		const announcementValues = vi.fn().mockResolvedValue(undefined);
		routeDb.select.mockReturnValue({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([{ id: 'wg-1' }]),
				})),
			})),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Mina' },
		});
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([{ id: itemId, name: 'Milch' }]),
				})),
			})),
		});
		routeDb.insert.mockReturnValue({
			values: announcementValues,
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/shopping/${itemId}`, {
				method: 'PATCH',
				body: JSON.stringify({ bought: true }),
			}),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: itemId,
				}),
			},
		);

		expect(res.status).toBe(200);
		expect(announcementValues).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'shopping',
				sourcePath: `/einkauf?highlight=${itemId}`,
			}),
		);
	});

	it('RED BUG-207-SHOPPING: rate-limits item updates by WG and member, not spoofable IP only', async () => {
		const { PATCH } = await import('./route');
		const itemId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const memberId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		routeDb.select.mockReturnValue({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([{ id: 'wg-1' }]),
				})),
			})),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Mina' },
		});
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([{ id: itemId, name: 'Milch' }]),
				})),
			})),
		});
		routeDb.insert.mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined),
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/shopping/${itemId}`, {
				method: 'PATCH',
				headers: { 'x-forwarded-for': '1.2.3.4' },
				body: JSON.stringify({ bought: true }),
			}),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: itemId,
				}),
			},
		);

		expect(res.status).toBe(200);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			expect.anything(),
			'shopping:item:wg-1:492a85d5-3232-4faf-a2dc-552165aa4dec',
		);
	});
});
