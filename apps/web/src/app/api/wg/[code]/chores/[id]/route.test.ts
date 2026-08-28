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

vi.mock('@/core/guards/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

describe('chore item route', () => {
	beforeEach(() => {
		resetRouteHarness();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
	});

	it('returns field-specific validation errors when updating chores', async () => {
		const { PATCH } = await import('./route');
		const choreId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { assignedMemberId: 'not-a-uuid' }, error: 'member_id_invalid' },
			{ body: { nextDueAt: 'morgen' }, error: 'due_date_invalid' },
		];

		for (const testCase of cases) {
			const res = await PATCH(
				new NextRequest(`https://mana.test/api/wg/MTE8PZAT/chores/${choreId}`, {
					method: 'PATCH',
					body: JSON.stringify(testCase.body),
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT', id: choreId }) },
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: testCase.error });
		}
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('returns id_invalid for malformed chore ids before auth or db work', async () => {
		const { DELETE, PATCH } = await import('./route');

		for (const handler of [PATCH, DELETE]) {
			const res = await handler(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/chores/not-a-uuid', {
					method: handler === PATCH ? 'PATCH' : 'DELETE',
					body:
						handler === PATCH ? JSON.stringify({ nextDueAt: '2026-05-20T00:00:00.000Z' }) : null,
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT', id: 'not-a-uuid' }) },
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: 'id_invalid' });
		}
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	const validChoreId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
	const callerMemberId = '11111111-1111-1111-1111-111111111111';

	function mockWgLookup(): void {
		routeDb.select.mockReturnValueOnce({
			from: () => ({
				where: () => ({
					limit: async () => [{ id: 'wg-1' }],
				}),
			}),
		});
	}

	it('forbids non-admin members from deleting chores', async () => {
		const { DELETE } = await import('./route');
		mockWgLookup();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Member', verified: false },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(false);

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/chores/${validChoreId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: validChoreId }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({
			error: 'admin_required',
			code: 'admin_required',
		});
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('allows admins to delete chores', async () => {
		const { DELETE } = await import('./route');
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
						limit: async () => [{ title: 'Küche putzen' }],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Admin', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(true);
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: validChoreId }],
			}),
		});

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/chores/${validChoreId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: validChoreId }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: validChoreId });
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledTimes(1);
	});

	it('uses the existing recurrence type cap when intervalDays is patched alone', async () => {
		const { PATCH } = await import('./route');
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
						limit: async () => [{ recurrenceType: 'months' }],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Member' },
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/chores/${validChoreId}`, {
				method: 'PATCH',
				body: JSON.stringify({ intervalDays: 100 }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: validChoreId }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'interval_invalid' });
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-547: rate-limits chore item PATCH before updating data', async () => {
		const { PATCH } = await import('./route');
		mockWgLookup();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Member' },
		});
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [
						{
							id: validChoreId,
							title: 'Bad putzen',
							assignedMemberId: null,
							nextDueAt: new Date('2026-05-26T00:00:00.000Z'),
							intervalDays: 14,
							recurrenceType: 'days',
						},
					],
				}),
			}),
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/chores/${validChoreId}`, {
				method: 'PATCH',
				body: JSON.stringify({ intervalDays: 14, recurrenceType: 'days' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: validChoreId }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`chore:wg-1:${callerMemberId}`,
		);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-548: rate-limits chore item DELETE before deleting data', async () => {
		const { DELETE } = await import('./route');
		mockWgLookup();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Admin', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(true);
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		routeDb.select.mockReturnValueOnce({
			from: () => ({
				where: () => ({
					limit: async () => [{ title: 'Bad putzen' }],
				}),
			}),
		});
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: validChoreId }],
			}),
		});

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/chores/${validChoreId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: validChoreId }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`chore:wg-1:${callerMemberId}`,
		);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
