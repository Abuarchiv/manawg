import { resetRouteHarness, routeDb, routeMocks, tableNameOf } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shareCodeMock = vi.hoisted(() => ({ generateShareCode: vi.fn() }));

const rateLimitMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

// Only the generator is stubbed, so the created WG's share code is
// deterministic; validation stays real.
vi.mock('@/shared/lib/share-code', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/shared/lib/share-code')>()),
	generateShareCode: () => shareCodeMock.generateShareCode(),
}));

// registerLimiter is nulled out for the 503 test; checkRateLimit is stubbed
// because this suite also asserts the 429 path.
vi.mock('@/core/rate-limit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/core/rate-limit')>()),
	checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
	registerLimiter: null,
}));

const txMock = vi.hoisted(() => ({ committed: false, rolledBack: false }));

vi.mock('@/core/db/transaction', async () => {
	const { TransactionAbort } = await import('@/core/db/transaction-abort');
	return {
		TransactionAbort,
		withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			try {
				const result = await fn({ insert: (...args: unknown[]) => routeDb.insert(...args) });
				txMock.committed = true;
				return result;
			} catch (err) {
				txMock.rolledBack = true;
				throw err;
			}
		},
	};
});

describe('WG create route', () => {
	beforeEach(() => {
		resetRouteHarness();
		shareCodeMock.generateShareCode.mockReturnValue('ABCD2345');
		routeDb.query.wgs.findFirst.mockResolvedValue(null);
		routeDb.insert.mockImplementation((table) => ({
			values: (value: unknown) => ({
				returning: async () => {
					if (tableNameOf(table) === 'wgs') {
						return [{ id: 'wg-1', shareCode: 'ABCD2345', name: 'Test WG' }];
					}
					if (tableNameOf(table) === 'wg_members') {
						return [{ id: 'member-1', name: Reflect.get(value as object, 'name') }];
					}
					return [];
				},
			}),
		}));
		routeDb.delete.mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined),
		});
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: -1, reset: 0 });
		txMock.committed = false;
		txMock.rolledBack = false;
	});

	it('records the WG creation audit event with the creator as actor', async () => {
		const { POST } = await import('./route');

		const res = await POST(
			new NextRequest('https://mana.test/api/wg', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test WG', creatorName: 'Ava' }),
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			wg: { id: 'wg-1', shareCode: 'ABCD2345', name: 'Test WG' },
			creator: { id: 'member-1', name: 'Ava' },
		});
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith({
			wgId: 'wg-1',
			memberId: 'member-1',
			eventType: 'wg.created',
			entityType: 'wg',
			entityId: 'wg-1',
			summary: 'Ava hat die WG Test WG erstellt.',
			metadata: { name: 'Test WG', shareCode: 'ABCD2345' },
		});
	});

	it('RED BUG-012: rate-limits WG creation by the platform-appended forwarded IP', async () => {
		const { POST } = await import('./route');

		const res = await POST(
			new NextRequest('https://mana.test/api/wg', {
				method: 'POST',
				headers: {
					'x-forwarded-for': '198.51.100.66, 203.0.113.10',
				},
				body: JSON.stringify({ name: 'Test WG', creatorName: 'Ava' }),
			}),
		);

		expect(res.status).toBe(200);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(null, '203.0.113.10', 'closed');
	});

	it('returns field-specific validation errors before creating a WG', async () => {
		const { POST } = await import('./route');
		const validBody = { name: 'Test WG', creatorName: 'Ava' };
		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { ...validBody, name: '' }, error: 'name_invalid' },
			{ body: { ...validBody, creatorName: '' }, error: 'creator_name_invalid' },
		];

		for (const testCase of cases) {
			const res = await POST(
				new NextRequest('https://mana.test/api/wg', {
					method: 'POST',
					body: JSON.stringify(testCase.body),
				}),
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: testCase.error });
		}
		expect(shareCodeMock.generateShareCode).not.toHaveBeenCalled();
		expect(routeDb.insert).not.toHaveBeenCalled();
	});

	/**
	 * A WG without its creator is a WG nobody can administer: the share code
	 * exists, the row exists, and the person who just created it is not a member
	 * of it. The WG and its first member are therefore one write.
	 */
	it('rolls the WG back and does not audit when creator member insert returns no row', async () => {
		const { POST } = await import('./route');
		routeDb.insert.mockImplementation((table) => ({
			values: () => ({
				returning: async () => {
					if (tableNameOf(table) === 'wgs')
						return [{ id: 'wg-1', shareCode: 'ABCD2345', name: 'Test WG' }];
					if (tableNameOf(table) === 'wg_members') return [];
					return [];
				},
			}),
		}));

		const res = await POST(
			new NextRequest('https://mana.test/api/wg', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test WG', creatorName: 'Ava' }),
			}),
		);

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: 'member_insert_failed' });
		expect(txMock.rolledBack).toBe(true);
		expect(txMock.committed).toBe(false);
		// The WG disappears with the rollback. It used to be removed by a
		// compensating delete, which is itself a database call and left the
		// orphaned WG behind whenever it failed.
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	/**
	 * The old code only compensated for a member insert that returned no row.
	 * When it threw instead — a dropped connection mid-request is the ordinary
	 * case — nothing cleaned up and the empty WG stayed for good.
	 */
	it('rolls the WG back when the creator member insert throws', async () => {
		const { POST } = await import('./route');
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		routeDb.insert.mockImplementation((table) => ({
			values: () => ({
				returning: async () => {
					if (tableNameOf(table) === 'wgs')
						return [{ id: 'wg-1', shareCode: 'ABCD2345', name: 'Test WG' }];
					throw new Error('connection reset');
				},
			}),
		}));

		try {
			const res = await POST(
				new NextRequest('https://mana.test/api/wg', {
					method: 'POST',
					body: JSON.stringify({ name: 'Test WG', creatorName: 'Ava' }),
				}),
			);

			expect(res.status).toBe(500);
			await expect(res.json()).resolves.toEqual({ error: 'db_error' });
			expect(txMock.rolledBack).toBe(true);
			expect(routeDb.delete).not.toHaveBeenCalled();
			expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		} finally {
			consoleErrorSpy.mockRestore();
		}
	});

	it('returns 503 when registerLimiter is unavailable', async () => {
		const { POST } = await import('./route');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: Date.now() + 60_000,
			limiterUnavailable: true,
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test WG', creatorName: 'Ava' }),
			}),
		);

		expect(res.status).toBe(503);
		await expect(res.json()).resolves.toEqual({
			error: 'rate_limiter_unavailable',
			retryAfterMs: expect.any(Number),
		});
		expect(res.headers.get('Retry-After')).toBe('60');
	});
});
