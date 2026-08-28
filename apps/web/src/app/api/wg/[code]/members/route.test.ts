import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	clientIpKey: vi.fn(),
	wgWriteLimiter: { name: 'wgWriteLimiter' },
}));

vi.mock('@/core/errors', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/errors')>();
	return actual;
});

const txMock = vi.hoisted(() => ({ committed: false, rolledBack: false }));

vi.mock('@/core/db/transaction', async () => {
	const { TransactionAbort } = await import('@/core/db/transaction-abort');
	return {
		TransactionAbort,
		withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			try {
				const result = await fn({
					execute: vi.fn().mockResolvedValue(undefined),
					insert: (...args: unknown[]) => routeDb.insert(...args),
					select: (...args: unknown[]) => routeDb.select(...args),
				});
				txMock.committed = true;
				return result;
			} catch (err) {
				txMock.rolledBack = true;
				throw err;
			}
		},
	};
});

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		clientIpKey: (...args: unknown[]) => rateLimitMock.clientIpKey(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

vi.mock('@/core/guards/resolve', () => ({
	resolveWg: vi.fn(),
}));

function chainRows(rows: unknown[]) {
	return {
		from: () => ({
			where: () => ({
				limit: async () => rows,
			}),
		}),
	};
}

describe('members route RED regressions', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.resetModules();
		routeDb.query.wgs.findFirst.mockResolvedValue({ id: 'wg-1', joiningEnabled: true });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		rateLimitMock.clientIpKey.mockReturnValue('198.51.100.9');
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 1, reset: 0 });
	});

	it('RED BUG-013: concurrent joins with the same name do not both insert members', async () => {
		const { POST } = await import('./route');
		let selectCall = 0;
		let insertCount = 0;
		const insertedMemberNames = new Set<string>();
		routeDb.select.mockImplementation(() => {
			selectCall += 1;
			// For both requests: member count below limit, name not found.
			return chainRows(selectCall % 2 === 1 ? Array.from({ length: 19 }, (_, id) => ({ id })) : []);
		});
		routeDb.insert.mockImplementation((table: unknown) => ({
			values: vi.fn((values: { name?: string; wgId?: string } = {}) => ({
				onConflictDoNothing: vi.fn(() => ({
					returning: vi.fn().mockImplementation(async () => {
						const key = `${values.wgId}:${values.name}`;
						if (insertedMemberNames.has(key)) return [];
						insertedMemberNames.add(key);
						insertCount += 1;
						return [{ id: `member-${insertCount}`, name: 'Max', color: null, wgId: 'wg-1' }];
					}),
				})),
				returning: vi.fn().mockImplementation(async () => {
					if (
						table &&
						typeof table === 'object' &&
						'tableName' in table &&
						table.tableName === 'announcements'
					) {
						return [];
					}
					insertCount += 1;
					return [{ id: `member-${insertCount}`, name: 'Max', color: null, wgId: 'wg-1' }];
				}),
			})),
		}));

		const makeRequest = () =>
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/members', {
				method: 'POST',
				body: JSON.stringify({ name: 'Max', color: '#fff' }),
			});

		const first = await POST(makeRequest(), { params: Promise.resolve({ code: 'MTE8PZAT' }) });
		const second = await POST(makeRequest(), { params: Promise.resolve({ code: 'MTE8PZAT' }) });

		expect(first.status).toBe(200);
		expect(second.status).toBe(409);
		expect(insertCount).toBe(1);
	});

	it('maps DB unique-name conflicts during join to 409 name_taken', async () => {
		const { POST } = await import('./route');
		let selectCall = 0;
		routeDb.select.mockImplementation(() => {
			selectCall += 1;
			return chainRows(selectCall % 2 === 1 ? Array.from({ length: 19 }, (_, id) => ({ id })) : []);
		});
		routeDb.insert.mockImplementation(() => ({
			values: vi.fn(() => ({
				onConflictDoNothing: vi.fn(() => ({
					returning: vi.fn().mockRejectedValue(
						Object.assign(new Error('duplicate'), {
							code: '23505',
							constraint: 'wg_members_unique_name_per_wg',
						}),
					),
				})),
			})),
		}));

		const response = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/members', {
				method: 'POST',
				body: JSON.stringify({ name: 'Max' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		await expect(response.json()).resolves.toMatchObject({ error: 'name_taken' });
		expect(response.status).toBe(409);
	});

	it('RED BUG-320: rate-limits member joins before inserting a new member', async () => {
		const { POST } = await import('./route');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		routeDb.select.mockReturnValue(chainRows([]));
		routeDb.insert.mockReturnValue({
			values: vi.fn(() => ({
				onConflictDoNothing: vi.fn(() => ({
					returning: vi
						.fn()
						.mockResolvedValue([{ id: 'member-1', name: 'Spam Bot', color: null, wgId: 'wg-1' }]),
				})),
			})),
		});

		const response = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/members', {
				method: 'POST',
				headers: { 'x-forwarded-for': '203.0.113.3, 198.51.100.9' },
				body: JSON.stringify({ name: 'Spam Bot' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(response.status).toBe(429);
		await expect(response.json()).resolves.toEqual({
			error: 'join_rate_limited',
			code: 'join_rate_limited',
		});
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'join:198.51.100.9',
		);
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
