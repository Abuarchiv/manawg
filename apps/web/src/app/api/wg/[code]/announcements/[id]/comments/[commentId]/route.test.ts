import { routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: {},
}));

vi.mock('@/lib/api-error', async () => {
	const actual = await vi.importActual<typeof import('@/lib/api-error')>('@/lib/api-error');
	return actual;
});

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

describe('announcement comment item route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
	});

	it('records before and after snippets when updating a comment', async () => {
		const { PATCH } = await import('./route');
		const announcementId = '11111111-1111-4111-8111-111111111111';
		const commentId = '22222222-2222-4222-8222-222222222222';
		const memberId = '33333333-3333-4333-8333-333333333333';
		routeDb.select
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([{ id: 'wg-1' }]),
					})),
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi
								.fn()
								.mockResolvedValue([{ memberId, content: 'Bitte heute Brokkoli holen.' }]),
						})),
					})),
				})),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Mina', verified: true },
		});
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi
						.fn()
						.mockResolvedValue([{ id: commentId, content: 'Bitte morgen Brokkoli holen.' }]),
				})),
			})),
		});

		const res = await PATCH(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}/comments/${commentId}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ content: 'Bitte morgen Brokkoli holen.' }),
				},
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: announcementId,
					commentId,
				}),
			},
		);

		expect(res.status).toBe(200);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'announcement.comment.updated',
				metadata: {
					announcementId,
					contentBefore: 'Bitte heute Brokkoli holen.',
					contentAfter: 'Bitte morgen Brokkoli holen.',
				},
			}),
		);
	});

	it('does not report a comment as deleted when deleting it returns no row', async () => {
		const { DELETE } = await import('./route');
		const announcementId = '11111111-1111-4111-8111-111111111111';
		const commentId = '22222222-2222-4222-8222-222222222222';
		const memberId = '33333333-3333-4333-8333-333333333333';
		routeDb.select
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([{ id: 'wg-1' }]),
					})),
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn().mockResolvedValue([{ memberId, content: 'Ich mache das.' }]),
						})),
					})),
				})),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Mina', verified: true },
		});
		routeDb.delete.mockReturnValue({
			where: vi.fn(() => ({
				returning: vi.fn().mockResolvedValue([]),
			})),
		});

		const res = await DELETE(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}/comments/${commentId}`,
				{ method: 'DELETE' },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: announcementId,
					commentId,
				}),
			},
		);

		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: 'comment_not_found' });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-524: rate-limits comment deletes before mutating data', async () => {
		const { DELETE } = await import('./route');
		const announcementId = '11111111-1111-4111-8111-111111111111';
		const commentId = '22222222-2222-4222-8222-222222222222';
		const memberId = '33333333-3333-4333-8333-333333333333';
		routeDb.select
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([{ id: 'wg-1' }]),
					})),
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn().mockResolvedValue([{ memberId, content: 'Ich mache das.' }]),
						})),
					})),
				})),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Mina', verified: true },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: false });
		routeDb.delete.mockReturnValue({
			where: vi.fn(() => ({
				returning: vi.fn().mockResolvedValue([{ id: commentId }]),
			})),
		});

		const res = await DELETE(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}/comments/${commentId}`,
				{ method: 'DELETE' },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: announcementId,
					commentId,
				}),
			},
		);

		expect(res.status).toBe(429);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	/**
	 * The owner check trusts the caller identity claimed by
	 * `x-manawg-member-id`, which is spoofable on its own (harvested from
	 * GET /api/wg/[code]/members). Editing or deleting someone's comment must
	 * require a verified HMAC token, matching the expense mutation pattern.
	 */
	it('RED AUTH-BOUNDARY: rejects comment PATCH from an unverified legacy caller', async () => {
		const { PATCH } = await import('./route');
		const announcementId = '11111111-1111-4111-8111-111111111111';
		const commentId = '22222222-2222-4222-8222-222222222222';
		const ownerId = '33333333-3333-4333-8333-333333333333';
		routeDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([{ id: 'wg-1' }]),
				})),
			})),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: ownerId, name: 'Mina', verified: false },
		});

		const res = await PATCH(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}/comments/${commentId}`,
				{ method: 'PATCH', body: JSON.stringify({ content: 'Übernommen.' }) },
			),
			{
				params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId, commentId }),
			},
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toMatchObject({ error: 'member_not_verified' });
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED AUTH-BOUNDARY: rejects comment DELETE from an unverified legacy caller', async () => {
		const { DELETE } = await import('./route');
		const announcementId = '11111111-1111-4111-8111-111111111111';
		const commentId = '22222222-2222-4222-8222-222222222222';
		const ownerId = '33333333-3333-4333-8333-333333333333';
		routeDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([{ id: 'wg-1' }]),
				})),
			})),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: ownerId, name: 'Mina', verified: false },
		});

		const res = await DELETE(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}/comments/${commentId}`,
				{ method: 'DELETE' },
			),
			{
				params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId, commentId }),
			},
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toMatchObject({ error: 'member_not_verified' });
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
