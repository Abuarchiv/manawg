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

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

vi.mock('@/core/guards/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

describe('absences route', () => {
	beforeEach(() => {
		resetRouteHarness();
		routeDb.insert.mockReset();
		routeDb.select.mockReset();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
	});

	it('returns field-specific validation errors when creating absences', async () => {
		const { POST } = await import('./route');
		const validBody = {
			memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			startDate: '2026-06-01T00:00:00.000Z',
			endDate: '2026-06-02T00:00:00.000Z',
			reason: null,
		};

		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { ...validBody, memberId: 'not-a-uuid' }, error: 'member_id_invalid' },
			{ body: { ...validBody, startDate: 'morgen' }, error: 'date_range_invalid' },
			{ body: { ...validBody, endDate: 'gestern' }, error: 'date_range_invalid' },
			{ body: { ...validBody, reason: 'x'.repeat(121) }, error: 'reason_invalid' },
		];

		for (const testCase of cases) {
			const res = await POST(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/absences', {
					method: 'POST',
					body: JSON.stringify(testCase.body),
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: testCase.error });
		}
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('does not audit or report success when the absence insert returns no row', async () => {
		const { POST } = await import('./route');
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
						limit: async () => [{ id: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Ava', verified: true },
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [],
			}),
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/absences', {
				method: 'POST',
				body: JSON.stringify({
					memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					startDate: '2026-06-01T00:00:00.000Z',
					endDate: '2026-06-02T00:00:00.000Z',
					reason: 'Urlaub',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: 'insert_failed' });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('rejects overlapping absences for the same member in the same WG', async () => {
		const { POST } = await import('./route');
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
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
						limit: async () => [{ id: memberId }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [{ id: 'absence-1' }],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Ava', verified: true },
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/absences', {
				method: 'POST',
				body: JSON.stringify({
					memberId,
					startDate: '2026-06-05T00:00:00.000Z',
					endDate: '2026-06-10T00:00:00.000Z',
					reason: 'Urlaub',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({
			error: 'absence_overlaps_existing',
			code: 'absence_overlaps_existing',
		});
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-177: forbids regular members from creating absences for another member', async () => {
		const { POST } = await import('./route');
		const callerMemberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const targetMemberId = '6c3b0e4b-48f2-4743-9e2c-f0c0771cbd1f';
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
						limit: async () => [{ id: targetMemberId }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerMemberId, name: 'Ava', verified: true },
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [
					{
						id: 'absence-2',
						wgId: 'wg-1',
						memberId: targetMemberId,
						startDate: new Date('2026-06-05T00:00:00.000Z'),
						endDate: new Date('2026-06-10T00:00:00.000Z'),
						reason: 'Fremde Abwesenheit',
					},
				],
			}),
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/absences', {
				method: 'POST',
				body: JSON.stringify({
					memberId: targetMemberId,
					startDate: '2026-06-05T00:00:00.000Z',
					endDate: '2026-06-10T00:00:00.000Z',
					reason: 'Fremde Abwesenheit',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-550: rate-limits absence creation before inserting data', async () => {
		const { POST } = await import('./route');
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
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
						limit: async () => [{ id: memberId }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [],
					}),
				}),
			});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Ava', verified: true },
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
						id: 'absence-1',
						wgId: 'wg-1',
						memberId,
						startDate: new Date('2026-06-05T00:00:00.000Z'),
						endDate: new Date('2026-06-10T00:00:00.000Z'),
						reason: 'Urlaub',
					},
				],
			}),
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/absences', {
				method: 'POST',
				body: JSON.stringify({
					memberId,
					startDate: '2026-06-05T00:00:00.000Z',
					endDate: '2026-06-10T00:00:00.000Z',
					reason: 'Urlaub',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`absence:wg-1:${memberId}`,
		);
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
