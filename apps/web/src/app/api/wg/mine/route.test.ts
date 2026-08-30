import { chainOf, resetRouteHarness, routeDb } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock('@/core/auth/server', () => ({
	getAuthenticatedUser: (...args: unknown[]) => authMock.getAuthenticatedUser(...args),
}));

describe('my WGs route', () => {
	beforeEach(() => {
		resetRouteHarness();
		authMock.getAuthenticatedUser.mockReset();
	});

	it('returns only the signed-in account memberships', async () => {
		authMock.getAuthenticatedUser.mockResolvedValue({ id: 'auth-user-1' });
		routeDb.select.mockReturnValue(
			chainOf([{ id: 'wg-1', memberId: 'member-1', name: 'Küche 4', code: 'MTE8PZAT' }]),
		);
		const { GET } = await import('./route');

		const res = await GET(new NextRequest('https://mana.test/api/wg/mine'));

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			wgs: [{ id: 'wg-1', memberId: 'member-1', name: 'Küche 4', code: 'MTE8PZAT' }],
		});
		expect(routeDb.select).toHaveBeenCalledTimes(1);
	});

	it('does not reveal memberships without a verified account', async () => {
		authMock.getAuthenticatedUser.mockResolvedValue(null);
		const { GET } = await import('./route');

		const res = await GET(new NextRequest('https://mana.test/api/wg/mine'));

		expect(res.status).toBe(401);
		expect(routeDb.select).not.toHaveBeenCalled();
	});
});
