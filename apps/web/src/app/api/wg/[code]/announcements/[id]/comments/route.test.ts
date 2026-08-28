import { routeDb, routeMocks } from '@/test/route-harness';
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
		wgWriteLimiter: {},
	};
});

function selectRows(rows: unknown[]) {
	return {
		from: () => ({
			where: () => ({
				limit: async () => rows,
			}),
		}),
	};
}

describe('announcement comments route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: {
				color: '#14b8a6',
				memberId: '33333333-3333-4333-8333-333333333333',
				name: 'Mina',
			},
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		routeMocks.dispatchNotification.mockResolvedValue(undefined);
	});

	it('RED BUG-122: returns the author color for a newly created comment', async () => {
		const { POST } = await import('./route');
		const announcementId = '11111111-1111-4111-8111-111111111111';
		const commentId = '22222222-2222-4222-8222-222222222222';
		routeDb.select
			.mockReturnValueOnce(selectRows([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]))
			.mockReturnValueOnce(
				selectRows([
					{
						authorMemberId: '44444444-4444-4444-8444-444444444444',
						content: 'Bitte Brokkoli holen.',
						id: announcementId,
					},
				]),
			)
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [],
				}),
			});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [
					{
						announcementId,
						content: 'Ich mache das.',
						id: commentId,
						memberId: '33333333-3333-4333-8333-333333333333',
					},
				],
			}),
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}/comments`,
				{
					method: 'POST',
					body: JSON.stringify({ content: 'Ich mache das.' }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			comment: {
				authorColor: '#14b8a6',
				authorName: 'Mina',
				id: commentId,
			},
		});
	});
});
