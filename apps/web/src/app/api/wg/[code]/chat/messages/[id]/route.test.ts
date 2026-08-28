import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

const resolveMock = vi.hoisted(() => ({
	resolveWg: vi.fn(),
}));

const adminMock = vi.hoisted(() => ({
	isVerifiedWgAdmin: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: {},
	};
});

vi.mock('@/lib/wg/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

vi.mock('@/lib/wg/resolve', () => ({
	resolveWg: (...args: unknown[]) => resolveMock.resolveWg(...args),
}));

describe('chat message [id] route', () => {
	beforeEach(() => {
		resetRouteHarness();
		resolveMock.resolveWg.mockResolvedValue({ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' });
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava', verified: true },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
	});

	it('rejects non-UUID id on PATCH', async () => {
		const { PATCH } = await import('./route');
		const res = await PATCH(
			new NextRequest('https://manawg.test/api/wg/MTE8PZAT/chat/messages/abc', {
				method: 'PATCH',
				body: JSON.stringify({ body: 'hi' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: 'abc' }) },
		);
		expect(res.status).toBe(400);
	});

	it('rejects invalid share code on DELETE', async () => {
		const { DELETE } = await import('./route');
		const res = await DELETE(
			new NextRequest(
				'https://manawg.test/api/wg/xxx/chat/messages/11111111-2222-3333-4444-555555555555',
				{
					method: 'DELETE',
				},
			),
			{
				params: Promise.resolve({
					code: 'xxx',
					id: '11111111-2222-3333-4444-555555555555',
				}),
			},
		);
		expect(res.status).toBe(400);
	});

	it('rejects empty body on PATCH', async () => {
		const { PATCH } = await import('./route');
		const res = await PATCH(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555',
				{
					method: 'PATCH',
					body: JSON.stringify({ body: '' }),
				},
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

	it('rate-limits DELETE before loading the message', async () => {
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, reset: 0 });
		const { DELETE } = await import('./route');
		const res = await DELETE(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555',
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
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			expect.anything(),
			'chat-delete:wg-1:member-1',
		);
		expect(routeDb.select).not.toHaveBeenCalled();
	});

	/**
	 * The owner checks trust the caller identity claimed by the spoofable
	 * `x-manawg-member-id` header (harvestable from GET /api/wg/[code]/members).
	 * A bare header claiming the author's id must not be able to edit or delete
	 * another member's message — mutations require a verified HMAC token,
	 * matching the comment/expense mutation pattern.
	 */
	it('IDOR: rejects message PATCH from an unverified caller claiming the author id', async () => {
		const { PATCH } = await import('./route');
		routeMocks.requireMember.mockResolvedValueOnce({
			ok: true,
			member: { memberId: 'author-1', name: 'Ava', verified: false },
		});

		const res = await PATCH(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555',
				{ method: 'PATCH', body: JSON.stringify({ body: 'hacked' }) },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: '11111111-2222-3333-4444-555555555555',
				}),
			},
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toMatchObject({ error: 'member_not_verified' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('IDOR: rejects message DELETE from an unverified caller claiming the author id', async () => {
		const { DELETE } = await import('./route');
		routeMocks.requireMember.mockResolvedValueOnce({
			ok: true,
			member: { memberId: 'author-1', name: 'Ava', verified: false },
		});

		const res = await DELETE(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555',
				{ method: 'DELETE' },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: '11111111-2222-3333-4444-555555555555',
				}),
			},
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toMatchObject({ error: 'member_not_verified' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('allows message PATCH by a verified author', async () => {
		const { PATCH } = await import('./route');
		routeDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([
						{
							id: '11111111-2222-3333-4444-555555555555',
							wgId: 'wg-1',
							senderMemberId: 'member-1',
							kind: 'text',
							body: 'alt',
							createdAt: new Date(),
							editedAt: null,
							deletedAt: null,
						},
					]),
				})),
			})),
		});
		const updated = { id: '11111111-2222-3333-4444-555555555555', body: 'neu' };
		routeDb.update.mockReturnValueOnce({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([updated]),
				})),
			})),
		});

		const res = await PATCH(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555',
				{ method: 'PATCH', body: JSON.stringify({ body: 'neu' }) },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: '11111111-2222-3333-4444-555555555555',
				}),
			},
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ message: updated });
	});

	it("allows message DELETE of another member's message by a verified WG admin", async () => {
		const { DELETE } = await import('./route');
		routeMocks.requireMember.mockResolvedValueOnce({
			ok: true,
			member: { memberId: 'admin-1', name: 'Admin', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValueOnce(true);
		routeDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([
						{
							id: '11111111-2222-3333-4444-555555555555',
							senderMemberId: 'member-1',
							kind: 'text',
							body: 'fremd',
							deletedAt: null,
						},
					]),
				})),
			})),
		});
		routeDb.update.mockReturnValueOnce({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([{ id: '11111111-2222-3333-4444-555555555555' }]),
				})),
			})),
		});

		const res = await DELETE(
			new NextRequest(
				'https://manawg.test/api/wg/MTE8PZAT/chat/messages/11111111-2222-3333-4444-555555555555',
				{ method: 'DELETE' },
			),
			{
				params: Promise.resolve({
					code: 'MTE8PZAT',
					id: '11111111-2222-3333-4444-555555555555',
				}),
			},
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ deleted: true });
		expect(adminMock.isVerifiedWgAdmin).toHaveBeenCalledWith('wg-1', 'admin-1', true);
	});
});
