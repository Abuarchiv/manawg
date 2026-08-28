import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

const resolveMock = vi.hoisted(() => ({
	resolveWg: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		chatReadLimiter: {},
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
	};
});

vi.mock('@/lib/wg/resolve', () => ({
	resolveWg: (...args: unknown[]) => resolveMock.resolveWg(...args),
}));

describe('chat read route', () => {
	beforeEach(() => {
		resetRouteHarness();
		resolveMock.resolveWg.mockResolvedValue({ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' });
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava' },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
	});

	it('rejects malformed body', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://manawg.test/api/wg/MTE8PZAT/chat/read', {
				method: 'POST',
				body: JSON.stringify({ lastReadMessageId: 'not-a-uuid' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
	});

	it('rejects invalid share code', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://manawg.test/api/wg/x/chat/read', {
				method: 'POST',
				body: JSON.stringify({ lastReadMessageId: null }),
			}),
			{ params: Promise.resolve({ code: 'x' }) },
		);
		expect(res.status).toBe(400);
	});

	it('does not move the read pointer backwards to an older message', async () => {
		const olderMessageId = '11111111-1111-1111-1111-111111111111';
		const newerMessageId = '22222222-2222-2222-2222-222222222222';
		const responses = [
			[{ id: olderMessageId, createdAt: new Date('2026-05-24T10:00:00.000Z') }],
			[{ lastReadMessageId: newerMessageId }],
			[{ createdAt: new Date('2026-05-24T11:00:00.000Z') }],
		];
		routeDb.select.mockImplementation(() => ({
			from: () => ({
				where: () => ({
					limit: async () => responses.shift() ?? [],
				}),
			}),
		}));

		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://manawg.test/api/wg/MTE8PZAT/chat/read', {
				method: 'POST',
				body: JSON.stringify({ lastReadMessageId: olderMessageId }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(routeDb.insert).not.toHaveBeenCalled();
	});
});
