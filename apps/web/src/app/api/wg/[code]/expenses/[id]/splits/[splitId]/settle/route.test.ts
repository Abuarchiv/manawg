import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'wg-write-limiter' },
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

describe('expense split settle route', () => {
	beforeEach(() => {
		resetRouteHarness();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
	});

	it('rejects non-boolean settled values before auth or db work', async () => {
		const { POST } = await import('./route');
		const expenseId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const splitId = '989ac820-58b7-431f-9c65-28721264f333';

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}/splits/${splitId}/settle`,
				{
					method: 'POST',
					body: JSON.stringify({ settled: 'false' }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId, splitId }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'settled_invalid' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('rejects malformed JSON before auth or db work', async () => {
		const { POST } = await import('./route');
		const expenseId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const splitId = '989ac820-58b7-431f-9c65-28721264f333';

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}/splits/${splitId}/settle`,
				{
					method: 'POST',
					body: '{',
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId, splitId }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'invalid_json' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('does not update or audit when settling an already-settled split', async () => {
		const { POST } = await import('./route');
		const expenseId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const splitId = '989ac820-58b7-431f-9c65-28721264f333';
		const settledAt = new Date('2026-05-20T10:00:00.000Z');
		routeDb.select
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							limit: async () => [
								{
									id: expenseId,
									wgId: 'wg-1',
									description: 'Internet',
									paidByMemberId: 'member-creditor',
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [
							{
								id: splitId,
								debtorMemberId: 'member-debtor',
								expenseId,
								settledAt,
							},
						],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-debtor', name: 'Ben', verified: true },
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}/splits/${splitId}/settle`,
				{
					method: 'POST',
					body: JSON.stringify({ settled: true }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId, splitId }) },
		);

		expect(res.status).toBe(200);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('does not update or audit when reopening an already-open split', async () => {
		const { POST } = await import('./route');
		const expenseId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const splitId = '989ac820-58b7-431f-9c65-28721264f333';
		routeDb.select
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							limit: async () => [
								{
									id: expenseId,
									wgId: 'wg-1',
									description: 'Internet',
									paidByMemberId: 'member-creditor',
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [
							{
								id: splitId,
								debtorMemberId: 'member-debtor',
								expenseId,
								settledAt: null,
							},
						],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-creditor', name: 'Ava', verified: true },
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}/splits/${splitId}/settle`,
				{
					method: 'POST',
					body: JSON.stringify({ settled: false }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId, splitId }) },
		);

		expect(res.status).toBe(200);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('no-ops instead of overwriting when settling a split someone else already settled', async () => {
		const { POST } = await import('./route');
		const expenseId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const splitId = '989ac820-58b7-431f-9c65-28721264f333';
		routeDb.select
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							limit: async () => [
								{
									id: expenseId,
									wgId: 'wg-1',
									description: 'Internet',
									paidByMemberId: 'member-creditor',
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						// Our read still sees the split as unsettled — a concurrent
						// request settled it after this read but before our UPDATE.
						limit: async () => [
							{
								id: splitId,
								debtorMemberId: 'member-debtor',
								expenseId,
								settledAt: null,
							},
						],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-debtor', name: 'Ben', verified: true },
		});
		// The guarded UPDATE (isNull(settledAt)) matches zero rows because the
		// split was already settled by the other request.
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}/splits/${splitId}/settle`,
				{
					method: 'POST',
					body: JSON.stringify({ settled: true }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId, splitId }) },
		);

		expect(res.status).toBe(200);
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('no-ops instead of overwriting when un-settling a split someone else already reopened', async () => {
		const { POST } = await import('./route');
		const expenseId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const splitId = '989ac820-58b7-431f-9c65-28721264f333';
		const settledAt = new Date('2026-05-20T10:00:00.000Z');
		routeDb.select
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							limit: async () => [
								{
									id: expenseId,
									wgId: 'wg-1',
									description: 'Internet',
									paidByMemberId: 'member-creditor',
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						// Our read still sees the split as settled — a concurrent
						// request reopened it after this read but before our UPDATE.
						limit: async () => [
							{
								id: splitId,
								debtorMemberId: 'member-debtor',
								expenseId,
								settledAt,
							},
						],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-debtor', name: 'Ben', verified: true },
		});
		// The guarded UPDATE (isNotNull(settledAt)) matches zero rows because
		// the split was already reopened by the other request.
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}/splits/${splitId}/settle`,
				{
					method: 'POST',
					body: JSON.stringify({ settled: false }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId, splitId }) },
		);

		expect(res.status).toBe(200);
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-554: rate-limits split settle before updating data', async () => {
		const { POST } = await import('./route');
		const expenseId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const splitId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = 'member-debtor';
		routeDb.select
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							limit: async () => [
								{
									id: expenseId,
									wgId: 'wg-1',
									description: 'Internet',
									paidByMemberId: 'member-creditor',
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [
							{
								id: splitId,
								debtorMemberId: memberId,
								expenseId,
								settledAt: null,
							},
						],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Ben', verified: true },
		});
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: splitId, settledAt: new Date() }],
				}),
			}),
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}/splits/${splitId}/settle`,
				{
					method: 'POST',
					body: JSON.stringify({ settled: true }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId, splitId }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`split-settle:wg-1:${memberId}`,
		);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
