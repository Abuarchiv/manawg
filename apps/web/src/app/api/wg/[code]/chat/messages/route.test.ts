import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		chatMessageLimiter: {},
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
	};
});

vi.mock('@upstash/redis/cloudflare', () => ({
	Redis: vi.fn(),
}));

vi.mock('@upstash/ratelimit', () => ({
	Ratelimit: Object.assign(vi.fn(), {
		slidingWindow: vi.fn(() => 'window'),
	}),
}));

vi.mock('@/lib/wg/resolve', () => ({
	resolveWg: vi.fn(() => Promise.resolve({ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' })),
}));

/**
 * Two tests here assert *how* a query is scoped — that reply targets exclude
 * soft-deleted rows, and that pagination carries a stable tiebreaker. Those
 * need the operators to be inspectable, so the three involved are replaced
 * with markers while the rest of drizzle (including relations and sql, which
 * the schema module needs at import time) stays real.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: (...args: unknown[]) => ({ and: args }),
	or: (...args: unknown[]) => ({ or: args }),
	eq: (_col: unknown, value: unknown) => ({ eq: ['col', value] }),
	isNull: () => ({ isNull: ['col'] }),
	lt: (_col: unknown, value: unknown) => ({ lt: ['col', value] }),
}));

describe('chat messages route', () => {
	beforeEach(() => {
		resetRouteHarness();
	});

	it('rejects invalid share code', async () => {
		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://manawg.test/api/wg/zzz/chat/messages'), {
			params: Promise.resolve({ code: 'zzz' }),
		});
		expect(res.status).toBe(400);
	});

	it('rejects empty body on POST', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://manawg.test/api/wg/MTE8PZAT/chat/messages', {
				method: 'POST',
				body: JSON.stringify({ body: '   ' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'empty_message' });
		expect(routeDb.select).not.toHaveBeenCalled();
	});

	it('rejects invalid json on POST', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://manawg.test/api/wg/MTE8PZAT/chat/messages', {
				method: 'POST',
				body: 'not-json',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
	});

	it('checks that reply targets are not soft-deleted', async () => {
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava' },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		let replyWhere: unknown;
		routeDb.select.mockImplementation((shape?: unknown) => {
			if (shape && typeof shape === 'object' && 'id' in shape) {
				return {
					from: () => ({
						where: (where: unknown) => {
							replyWhere = where;
							return { limit: async () => [{ id: 'reply-1' }] };
						},
					}),
				};
			}
			return {
				from: () => ({
					where: () => ({ limit: async () => [] }),
				}),
			};
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [
					{
						id: 'new-message',
						body: 'Antwort',
						imageUrl: null,
					},
				],
			}),
		});

		const { POST } = await import('./route');
		await POST(
			new NextRequest('https://manawg.test/api/wg/MTE8PZAT/chat/messages', {
				method: 'POST',
				body: JSON.stringify({
					body: 'Antwort',
					replyToMessageId: '11111111-2222-3333-4444-555555555555',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(replyWhere).toEqual(
			expect.objectContaining({
				and: expect.arrayContaining([expect.objectContaining({ isNull: ['col'] })]),
			}),
		);
	});

	it('RED BUG-025: uses a stable id tiebreaker when paginating messages with equal timestamps', async () => {
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava' },
		});
		let messageWhere: unknown;
		routeDb.select.mockImplementation((shape?: unknown) => {
			if (shape && typeof shape === 'object' && 'messageId' in shape) {
				return {
					from: () => ({
						where: () => [],
					}),
				};
			}
			return {
				from: () => ({
					where: (where: unknown) => ({
						orderBy: () => ({
							limit: async () => {
								messageWhere = where;
								return [];
							},
						}),
					}),
				}),
			};
		});

		const { GET } = await import('./route');
		const cursor = encodeURIComponent('2026-05-25T10:00:00.000Z');
		const res = await GET(
			new NextRequest(
				`https://manawg.test/api/wg/MTE8PZAT/chat/messages?limit=50&before=${cursor}&beforeId=11111111-2222-3333-4444-555555555555`,
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(messageWhere).toEqual(
			expect.objectContaining({
				and: expect.arrayContaining([
					expect.objectContaining({
						or: expect.arrayContaining([
							expect.objectContaining({ lt: ['col', new Date('2026-05-25T10:00:00.000Z')] }),
							expect.objectContaining({
								and: expect.arrayContaining([
									expect.objectContaining({ eq: ['col', new Date('2026-05-25T10:00:00.000Z')] }),
									expect.objectContaining({
										lt: ['col', '11111111-2222-3333-4444-555555555555'],
									}),
								]),
							}),
						]),
					}),
				]),
			}),
		);
	});
});
