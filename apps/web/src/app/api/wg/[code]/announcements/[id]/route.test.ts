import { routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminMock = vi.hoisted(() => ({
	isVerifiedWgAdmin: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

vi.mock('@/features/pinnwand/announcement-workflow', () => ({
	ANNOUNCEMENT_KINDS: ['info', 'request', 'event'],
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: {},
	};
});

vi.mock('@/core/guards/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

describe('announcement item route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true });
	});

	it('returns field-specific validation errors for announcement updates before auth or db work', async () => {
		const { PATCH } = await import('./route');
		const announcementId = '39cb9a19-dac7-4da0-ac98-1ed433d67a57';
		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { status: 'done' }, error: 'status_invalid' },
			{ body: { pinned: 'yes' }, error: 'pinned_invalid' },
			{ body: { kind: 'urgent' }, error: 'kind_invalid' },
		];

		for (const testCase of cases) {
			const res = await PATCH(
				new NextRequest(`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}`, {
					method: 'PATCH',
					body: JSON.stringify(testCase.body),
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: testCase.error });
		}
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	const announcementId = '39cb9a19-dac7-4da0-ac98-1ed433d67a57';
	const callerMemberId = '11111111-1111-1111-1111-111111111111';
	const otherMemberId = '22222222-2222-2222-2222-222222222222';

	function mockWgAndAnnouncementLookup(authorMemberId: string): void {
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
						limit: async () => [{ authorMemberId, content: 'Hallo' }],
					}),
				}),
			});
	}

	it('forbids non-author non-admin from deleting an announcement', async () => {
		const { DELETE } = await import('./route');
		mockWgAndAnnouncementLookup(otherMemberId);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Member', verified: false },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(false);

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-220/345/530: forbids non-author non-admin from changing kind or pinned state', async () => {
		const { PATCH } = await import('./route');
		mockWgAndAnnouncementLookup(otherMemberId);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Member', verified: false },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true });
		adminMock.isVerifiedWgAdmin.mockResolvedValue(false);
		const updateSet = vi.fn(() => ({
			where: () => ({
				returning: async () => [
					{
						id: announcementId,
						kind: 'event',
						pinnedAt: new Date('2026-05-25T10:00:00.000Z'),
						status: 'open',
					},
				],
			}),
		}));
		routeDb.update.mockReturnValue({ set: updateSet });

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}`, {
				method: 'PATCH',
				body: JSON.stringify({ kind: 'event', pinned: true }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(updateSet).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('allows the admin to delete another members announcement', async () => {
		const { DELETE } = await import('./route');
		mockWgAndAnnouncementLookup(otherMemberId);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Admin', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(true);
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: announcementId }],
			}),
		});

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: true });
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledTimes(1);
	});

	it('allows the author to delete their own announcement without checking admin', async () => {
		const { DELETE } = await import('./route');
		mockWgAndAnnouncementLookup(callerMemberId);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Author', verified: true },
		});
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: announcementId }],
			}),
		});

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
		);

		expect(res.status).toBe(200);
		expect(adminMock.isVerifiedWgAdmin).not.toHaveBeenCalled();
	});

	it('RED BUG-523: rate-limits announcement deletes before mutating data', async () => {
		const { DELETE } = await import('./route');
		mockWgAndAnnouncementLookup(callerMemberId);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Author', verified: true },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: false });
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: announcementId }],
			}),
		});

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
		);

		expect(res.status).toBe(429);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
