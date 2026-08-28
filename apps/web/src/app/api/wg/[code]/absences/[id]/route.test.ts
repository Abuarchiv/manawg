import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminMock = vi.hoisted(() => ({
	isVerifiedWgAdmin: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'wg-write-limiter' },
}));

vi.mock('@/lib/wg/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

describe('absence item route', () => {
	beforeEach(() => {
		resetRouteHarness();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
	});

	it('returns id_invalid for malformed absence ids before auth or db work', async () => {
		const { DELETE } = await import('./route');

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/absences/not-a-uuid', {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: 'not-a-uuid' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'id_invalid' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	const validAbsenceId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
	const callerMemberId = '11111111-1111-1111-1111-111111111111';
	const otherMemberId = '22222222-2222-2222-2222-222222222222';

	function mockWgAndAbsenceLookup(absenceOwnerId: string): void {
		routeDb.select
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [{ id: 'wg-1' }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [{ memberId: absenceOwnerId }],
					}),
				}),
			});
	}

	it('forbids deleting another member absence when caller is not admin', async () => {
		const { DELETE } = await import('./route');
		mockWgAndAbsenceLookup(otherMemberId);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Caller', verified: false },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(false);

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/absences/${validAbsenceId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: validAbsenceId }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('allows the admin to delete another member absence', async () => {
		const { DELETE } = await import('./route');
		mockWgAndAbsenceLookup(otherMemberId);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Admin', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(true);
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [
					{
						id: validAbsenceId,
						memberId: otherMemberId,
						startDate: new Date('2026-06-01T00:00:00.000Z'),
						endDate: new Date('2026-06-02T00:00:00.000Z'),
					},
				],
			}),
		});

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/absences/${validAbsenceId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: validAbsenceId }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: validAbsenceId });
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledTimes(1);
	});

	it('allows the owner to delete their own absence without checking admin', async () => {
		const { DELETE } = await import('./route');
		mockWgAndAbsenceLookup(callerMemberId);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Owner', verified: true },
		});
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [
					{
						id: validAbsenceId,
						memberId: callerMemberId,
						startDate: new Date('2026-06-01T00:00:00.000Z'),
						endDate: new Date('2026-06-02T00:00:00.000Z'),
					},
				],
			}),
		});

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/absences/${validAbsenceId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: validAbsenceId }) },
		);

		expect(res.status).toBe(200);
		expect(adminMock.isVerifiedWgAdmin).not.toHaveBeenCalled();
	});

	it('RED BUG-551: rate-limits absence DELETE before deleting data', async () => {
		const { DELETE } = await import('./route');
		mockWgAndAbsenceLookup(callerMemberId);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Owner', verified: true },
		});
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [
					{
						id: validAbsenceId,
						memberId: callerMemberId,
						startDate: new Date('2026-06-01T00:00:00.000Z'),
						endDate: new Date('2026-06-02T00:00:00.000Z'),
					},
				],
			}),
		});

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/absences/${validAbsenceId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: validAbsenceId }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`absence:wg-1:${callerMemberId}`,
		);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
