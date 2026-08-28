import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminMock = vi.hoisted(() => ({
	checkWgAdminAccess: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'wg-write-limiter' },
}));

vi.mock('@/lib/wg/admin', () => ({
	checkWgAdminAccess: (...args: unknown[]) => adminMock.checkWgAdminAccess(...args),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

function memberRows(rows: unknown[]) {
	return {
		from: () => ({
			where: async () => rows,
		}),
	};
}

describe('wg [code] route', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.resetModules();
		adminMock.checkWgAdminAccess.mockResolvedValue({ allowed: true });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		rateLimitMock.checkRateLimit.mockResolvedValue({
			success: true,
			remaining: 10,
			reset: 0,
		});
	});

	it('BUG-001: allows invite-code verification without exposing member ids', async () => {
		const { GET } = await import('./route');
		const authResponse = NextResponse.json(
			{ error: 'member_id_required', code: 'member_id_required' },
			{ status: 401 },
		);
		routeMocks.requireMember.mockResolvedValue({ ok: false, response: authResponse });
		routeDb.query.wgs.findFirst.mockResolvedValue({
			id: 'wg-1',
			name: 'Test WG',
			shareCode: 'MTE8PZAT',
			joiningEnabled: true,
			shareCodeRotatedAt: null,
			createdAt: new Date('2026-05-25T00:00:00Z'),
		});
		routeDb.select.mockReturnValue(
			memberRows([{ id: 'member-secret', name: 'Ava', color: '#f00' }]),
		);

		const res = await GET(new NextRequest('https://mana.test/api/wg/MTE8PZAT'), {
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			wg: {
				id: 'wg-1',
				name: 'Test WG',
				shareCode: 'MTE8PZAT',
				joiningEnabled: true,
				shareCodeRotatedAt: null,
				createdAt: new Date('2026-05-25T00:00:00Z').toISOString(),
			},
		});
		expect(routeMocks.requireMember).toHaveBeenCalledWith(expect.any(NextRequest), 'wg-1');
		expect(routeDb.select).not.toHaveBeenCalled();
	});

	it('RED BUG-393: rate-limits WG settings PATCH before updating data', async () => {
		const { PATCH } = await import('./route');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava' },
		});
		routeDb.query.wgs.findFirst.mockResolvedValue({
			id: 'wg-1',
			name: 'Test WG',
			joiningEnabled: true,
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [
						{
							id: 'wg-1',
							name: 'New WG',
							joiningEnabled: true,
						},
					],
				}),
			}),
		});

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT', {
				method: 'PATCH',
				body: JSON.stringify({ name: 'New WG' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'wg-settings:wg-1:member-1',
		);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-394: rate-limits WG DELETE before deleting data', async () => {
		const { DELETE } = await import('./route');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava' },
		});
		routeDb.query.wgs.findFirst.mockResolvedValue({ id: 'wg-1' });
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: 'wg-1' }],
			}),
		});

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT', { method: 'DELETE' }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'wg-settings:wg-1:member-1',
		);
		expect(routeDb.delete).not.toHaveBeenCalled();
	});

	it('rejects PATCH with 403 member_not_verified when the request is only legacy-authenticated', async () => {
		const { PATCH } = await import('./route');
		adminMock.checkWgAdminAccess.mockResolvedValue({ allowed: false, reason: 'not_verified' });
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava', verified: false },
		});
		routeDb.query.wgs.findFirst.mockResolvedValue({
			id: 'wg-1',
			name: 'Test WG',
			joiningEnabled: true,
		});

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT', {
				method: 'PATCH',
				body: JSON.stringify({ name: 'New WG' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toMatchObject({ error: 'member_not_verified' });
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
	});

	it('rejects DELETE with 403 member_not_verified when the request is only legacy-authenticated', async () => {
		const { DELETE } = await import('./route');
		adminMock.checkWgAdminAccess.mockResolvedValue({ allowed: false, reason: 'not_verified' });
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava', verified: false },
		});
		routeDb.query.wgs.findFirst.mockResolvedValue({ id: 'wg-1' });

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT', { method: 'DELETE' }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toMatchObject({ error: 'member_not_verified' });
		expect(routeDb.delete).not.toHaveBeenCalled();
	});

	it('allows DELETE with a verified admin token to proceed to the actual deletion', async () => {
		const { DELETE } = await import('./route');
		adminMock.checkWgAdminAccess.mockResolvedValue({ allowed: true });
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava', verified: true },
		});
		routeDb.query.wgs.findFirst.mockResolvedValue({ id: 'wg-1' });
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: 'wg-1' }],
			}),
		});

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT', { method: 'DELETE' }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: true });
		expect(routeDb.delete).toHaveBeenCalled();
	});
});
