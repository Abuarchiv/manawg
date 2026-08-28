import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const choreStatusMock = vi.hoisted(() => ({
	getChoreStatus: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'wg-write-limiter' },
}));

const resolveMock = vi.hoisted(() => ({
	resolveWg: vi.fn(),
}));

vi.mock('@/lib/chore-status', () => ({
	getChoreStatus: (...args: unknown[]) => choreStatusMock.getChoreStatus(...args),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

vi.mock('@/core/guards/resolve', () => ({
	resolveWg: (...args: unknown[]) => resolveMock.resolveWg(...args),
}));

describe('chores route', () => {
	beforeEach(() => {
		resetRouteHarness();
		choreStatusMock.getChoreStatus.mockReturnValue({ state: 'ok' });
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		resolveMock.resolveWg.mockResolvedValue({ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		routeMocks.dispatchNotification.mockResolvedValue(undefined);
	});

	it('returns member_id_invalid for malformed assigned members before auth or db work', async () => {
		const { POST } = await import('./route');

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/chores', {
				method: 'POST',
				body: JSON.stringify({
					title: 'Bad putzen',
					intervalDays: 7,
					assignedMemberId: 'not-a-uuid',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'member_id_invalid' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('returns one open gap count per assignee without assigning gaps to unassigned chores', async () => {
		const { GET } = await import('./route');
		const memberA = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const memberB = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
		const overdue = new Date('2026-01-01T00:00:00.000Z');
		routeDb.select
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{ id: 'chore-a1', assignedMemberId: memberA, nextDueAt: overdue },
							{ id: 'chore-a2', assignedMemberId: memberA, nextDueAt: overdue },
							{ id: 'chore-b1', assignedMemberId: memberB, nextDueAt: overdue },
							{ id: 'chore-open', assignedMemberId: null, nextDueAt: overdue },
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							orderBy: async () => [],
						}),
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: memberA, name: 'Ava' },
		});
		choreStatusMock.getChoreStatus.mockReturnValue({ state: 'overdue' });

		const res = await GET(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/chores', {
				headers: { 'x-member-id': memberA },
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(
			body.chores.map((chore: { id: string; openGapCountForAssignee: number }) => [
				chore.id,
				chore.openGapCountForAssignee,
			]),
		).toEqual([
			['chore-a1', 2],
			['chore-a2', 2],
			['chore-b1', 1],
			['chore-open', 0],
		]);
	});

	it('RED BUG-546: rate-limits chore creation before inserting data', async () => {
		const { POST } = await import('./route');
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Ava' },
		});
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [
					{
						id: 'chore-1',
						title: 'Bad putzen',
						intervalDays: 7,
						recurrenceType: 'days',
						assignedMemberId: null,
						nextDueAt: new Date('2026-05-26T00:00:00.000Z'),
					},
				],
			}),
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/chores', {
				method: 'POST',
				body: JSON.stringify({ title: 'Bad putzen', intervalDays: 7 }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`chore:wg-1:${memberId}`,
		);
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});
});
