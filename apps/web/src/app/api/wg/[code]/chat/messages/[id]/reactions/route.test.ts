import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));
const resolveMock = vi.hoisted(() => ({
	resolveWg: vi.fn(),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: {},
	};
});

vi.mock('@/core/guards/resolve', () => ({
	resolveWg: (...args: unknown[]) => resolveMock.resolveWg(...args),
}));

describe('chat reactions route', () => {
	beforeEach(() => {
		resetRouteHarness();
		resolveMock.resolveWg.mockResolvedValue({ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' });
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ada' },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true });
	});

	it('rejects multi-emoji body on POST', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555/reactions',
				{ method: 'POST', body: JSON.stringify({ emoji: '👍🎉' }) },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: '11111111-2222-3333-4444-555555555555',
				}),
			},
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'emoji_invalid' });
	});

	it('rejects DELETE without emoji', async () => {
		const { DELETE } = await import('./route');
		const res = await DELETE(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555/reactions',
				{ method: 'DELETE' },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: '11111111-2222-3333-4444-555555555555',
				}),
			},
		);
		expect(res.status).toBe(400);
	});

	it('RED BUG-545: rejects DELETE reactions on deleted messages before mutating reactions', async () => {
		const deleteWhere = vi.fn().mockResolvedValue(undefined);
		routeDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([{ id: 'message-1', deletedAt: new Date() }]),
				})),
			})),
		});
		routeDb.delete.mockReturnValueOnce({
			where: deleteWhere,
		});

		const { DELETE } = await import('./route');
		const res = await DELETE(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555/reactions?emoji=%F0%9F%91%8D',
				{ method: 'DELETE' },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: '11111111-2222-3333-4444-555555555555',
				}),
			},
		);

		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({ error: 'message_deleted' });
		expect(deleteWhere).not.toHaveBeenCalled();
	});

	it('RED BUG-545-RATE: rate-limits DELETE reactions before mutating reactions', async () => {
		routeDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([{ id: 'message-1', deletedAt: null }]),
				})),
			})),
		});
		const deleteWhere = vi.fn().mockResolvedValue(undefined);
		routeDb.delete.mockReturnValueOnce({ where: deleteWhere });
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({ success: false });

		const { DELETE } = await import('./route');
		const res = await DELETE(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555/reactions?emoji=%F0%9F%91%8D',
				{ method: 'DELETE' },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: '11111111-2222-3333-4444-555555555555',
				}),
			},
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalled();
		expect(deleteWhere).not.toHaveBeenCalled();
	});
});
