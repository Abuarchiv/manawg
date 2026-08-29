import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stands in for a real transaction: the callback writes through the same db
 * stub, and a throwing callback rolls back instead of committing.
 */
const txMock = vi.hoisted(() => ({ committed: false, rolledBack: false }));

vi.mock('@/core/db/transaction', async () => {
	const { TransactionAbort } = await import('@/core/db/transaction-abort');
	return {
		TransactionAbort,
		withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			try {
				const result = await fn({
					insert: (...args: unknown[]) => routeDb.insert(...args),
					update: (...args: unknown[]) => routeDb.update(...args),
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

const absenceMock = vi.hoisted(() => ({
	getAbsentMemberIds: vi.fn(),
}));

const fairnessMock = vi.hoisted(() => ({
	chooseNextAvailableMember: vi.fn(),
	computeOpenGapsByMember: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'wg-write-limiter' },
}));

const idempotencyMock = vi.hoisted(() => ({
	claimResponseSlot: vi.fn(),
	getCachedResponse: vi.fn(),
	readIdempotencyKey: vi.fn(),
	setCachedResponse: vi.fn(),
}));

vi.mock('@/core/idempotency', () => ({
	claimResponseSlot: (...args: unknown[]) => idempotencyMock.claimResponseSlot(...args),
	getCachedResponse: (...args: unknown[]) => idempotencyMock.getCachedResponse(...args),
	readIdempotencyKey: (...args: unknown[]) => idempotencyMock.readIdempotencyKey(...args),
	setCachedResponse: (...args: unknown[]) => idempotencyMock.setCachedResponse(...args),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

vi.mock('@/features/chores/absence', () => ({
	getAbsentMemberIds: (...args: unknown[]) => absenceMock.getAbsentMemberIds(...args),
}));

vi.mock('@/features/chores/chore-fairness', () => ({
	chooseNextAvailableMember: (...args: unknown[]) =>
		fairnessMock.chooseNextAvailableMember(...args),
	computeOpenGapsByMember: (...args: unknown[]) => fairnessMock.computeOpenGapsByMember(...args),
}));

describe('chore complete route', () => {
	beforeEach(() => {
		resetRouteHarness();
		txMock.committed = false;
		txMock.rolledBack = false;
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava' },
		});
		absenceMock.getAbsentMemberIds.mockReturnValue(new Set());
		fairnessMock.chooseNextAvailableMember.mockReturnValue('member-2');
		fairnessMock.computeOpenGapsByMember.mockReturnValue(new Map());
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		idempotencyMock.readIdempotencyKey.mockReturnValue(null);
		idempotencyMock.getCachedResponse.mockResolvedValue(null);
		idempotencyMock.claimResponseSlot.mockResolvedValue(true);
		idempotencyMock.setCachedResponse.mockResolvedValue(undefined);
	});

	it('does not audit or report success when the completion log insert returns no row', async () => {
		const { POST } = await import('./route');
		const choreId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => {
			selectIndex += 1;
			if (selectIndex === 1) {
				return {
					from: () => ({
						innerJoin: () => ({
							where: () => ({
								limit: async () => [
									{
										id: choreId,
										wgId: 'wg-1',
										intervalDays: 7,
										title: 'Bad putzen',
										assignedMemberId: 'member-1',
										nextDueAt: new Date('2026-05-20T00:00:00Z'),
									},
								],
							}),
						}),
					}),
				};
			}
			if (selectIndex === 2) {
				return {
					from: () => ({
						where: () => ({
							orderBy: async () => [
								{ id: 'member-1', name: 'Ava' },
								{ id: 'member-2', name: 'Mina' },
							],
						}),
					}),
				};
			}
			return {
				from: () => ({
					where: () => Promise.resolve([]),
				}),
			};
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: choreId, assignedMemberId: 'member-2' }],
				}),
			}),
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [],
			}),
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/ABCDEFGH/chores/${choreId}/complete`, {
				method: 'POST',
			}),
			{ params: Promise.resolve({ code: 'ABCDEFGH', id: choreId }) },
		);

		const json = await res.json();
		expect({ json, status: res.status }).toEqual({
			json: { error: 'completion_insert_failed' },
			status: 500,
		});
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		// A genuine insert failure must roll back the assignee rotation too —
		// otherwise the rotation advances with no completion row to show for it.
		expect(txMock.rolledBack).toBe(true);
		expect(txMock.committed).toBe(false);
	});

	it('RED BUG-384: commits the rotation as a no-op and returns 409 when a concurrent completion already advanced the chore', async () => {
		const { POST } = await import('./route');
		const choreId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => {
			selectIndex += 1;
			if (selectIndex === 1) {
				return {
					from: () => ({
						innerJoin: () => ({
							where: () => ({
								limit: async () => [
									{
										id: choreId,
										wgId: 'wg-1',
										intervalDays: 7,
										title: 'Bad putzen',
										assignedMemberId: 'member-1',
										nextDueAt: new Date('2026-05-20T00:00:00Z'),
									},
								],
							}),
						}),
					}),
				};
			}
			if (selectIndex === 2) {
				return {
					from: () => ({
						where: () => ({
							orderBy: async () => [
								{ id: 'member-1', name: 'Ava' },
								{ id: 'member-2', name: 'Mina' },
							],
						}),
					}),
				};
			}
			return {
				from: () => ({
					where: () => Promise.resolve([]),
				}),
			};
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/ABCDEFGH/chores/${choreId}/complete`, {
				method: 'POST',
			}),
			{ params: Promise.resolve({ code: 'ABCDEFGH', id: choreId }) },
		);

		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({ error: 'chore_already_completed' });
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		// Losing the CAS race is a normal outcome, not a failure: the
		// transaction must still commit (as a no-op) rather than roll back.
		expect(txMock.committed).toBe(true);
		expect(txMock.rolledBack).toBe(false);
	});

	it('RED BUG-385: fails completion when absence data cannot be loaded for assignee rotation', async () => {
		const { POST } = await import('./route');
		const choreId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => {
			selectIndex += 1;
			if (selectIndex === 1) {
				return {
					from: () => ({
						innerJoin: () => ({
							where: () => ({
								limit: async () => [
									{
										id: choreId,
										wgId: 'wg-1',
										intervalDays: 7,
										title: 'Bad putzen',
										assignedMemberId: 'member-1',
										nextDueAt: new Date('2026-05-20T00:00:00Z'),
									},
								],
							}),
						}),
					}),
				};
			}
			if (selectIndex === 2) {
				return {
					from: () => ({
						where: () => ({
							orderBy: async () => [
								{ id: 'member-1', name: 'Ava' },
								{ id: 'member-2', name: 'Mina' },
							],
						}),
					}),
				};
			}
			if (selectIndex === 3) {
				const rejected = Promise.reject(new Error('absence table unavailable')) as Promise<
					unknown[]
				> & {
					catch: Promise<unknown[]>['catch'];
					from: () => unknown;
					where: () => unknown;
				};
				rejected.from = () => rejected;
				rejected.where = () => rejected;
				return rejected;
			}
			return {
				from: () => ({
					where: () => Promise.resolve([]),
				}),
			};
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: choreId, assignedMemberId: 'member-2' }],
				}),
			}),
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [{ id: 'completion-1' }],
			}),
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/ABCDEFGH/chores/${choreId}/complete`, {
				method: 'POST',
			}),
			{ params: Promise.resolve({ code: 'ABCDEFGH', id: choreId }) },
		);

		expect(res.status).toBe(500);
		expect(fairnessMock.chooseNextAvailableMember).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('replays a cached chore completion without rotating twice', async () => {
		const { POST } = await import('./route');
		const choreId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		const key = '44444444-5555-4666-8777-888888888888';
		const cached = { chore: { id: choreId, assignedMemberId: 'member-2' } };
		routeDb.select.mockReturnValue({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [{ id: choreId, wgId: 'wg-1' }],
					}),
				}),
			}),
		});
		idempotencyMock.readIdempotencyKey.mockReturnValue(key);
		idempotencyMock.getCachedResponse.mockResolvedValue(cached);

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/ABCDEFGH/chores/${choreId}/complete`, {
				method: 'POST',
			}),
			{ params: Promise.resolve({ code: 'ABCDEFGH', id: choreId }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual(cached);
		expect(idempotencyMock.getCachedResponse).toHaveBeenCalledWith(
			`chores-complete:wg-1:member-1:${choreId}`,
			key,
		);
		expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-556: fails completion when chore snapshot cannot be loaded for fair rotation', async () => {
		const { POST } = await import('./route');
		const choreId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => {
			selectIndex += 1;
			if (selectIndex === 1) {
				return {
					from: () => ({
						innerJoin: () => ({
							where: () => ({
								limit: async () => [
									{
										id: choreId,
										wgId: 'wg-1',
										intervalDays: 7,
										recurrenceType: 'days',
										title: 'Bad putzen',
										assignedMemberId: 'member-1',
										nextDueAt: new Date('2026-05-20T00:00:00Z'),
									},
								],
							}),
						}),
					}),
				};
			}
			if (selectIndex === 2) {
				return {
					from: () => ({
						where: () => ({
							orderBy: async () => [
								{ id: 'member-1', name: 'Ava' },
								{ id: 'member-2', name: 'Mina' },
							],
						}),
					}),
				};
			}
			if (selectIndex === 3) {
				return {
					from: () => ({
						where: async () => [],
					}),
				};
			}
			const rejected = Promise.reject(new Error('chore snapshot unavailable')) as Promise<
				unknown[]
			> & {
				catch: Promise<unknown[]>['catch'];
				from: () => unknown;
				where: () => unknown;
			};
			rejected.from = () => rejected;
			rejected.where = () => rejected;
			return rejected;
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: choreId, assignedMemberId: 'member-2' }],
				}),
			}),
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [{ id: 'completion-1' }],
			}),
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/ABCDEFGH/chores/${choreId}/complete`, {
				method: 'POST',
			}),
			{ params: Promise.resolve({ code: 'ABCDEFGH', id: choreId }) },
		);

		expect(res.status).toBe(500);
		expect(fairnessMock.chooseNextAvailableMember).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('passes the real computeOpenGapsByMember result to chooseNextAvailableMember instead of hardcoding 0', async () => {
		const { POST } = await import('./route');
		const choreId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => {
			selectIndex += 1;
			if (selectIndex === 1) {
				return {
					from: () => ({
						innerJoin: () => ({
							where: () => ({
								limit: async () => [
									{
										id: choreId,
										wgId: 'wg-1',
										intervalDays: 7,
										recurrenceType: 'days',
										title: 'Bad putzen',
										assignedMemberId: 'member-1',
										nextDueAt: new Date('2026-05-20T00:00:00Z'),
									},
								],
							}),
						}),
					}),
				};
			}
			if (selectIndex === 2) {
				return {
					from: () => ({
						where: () => ({
							orderBy: async () => [
								{ id: 'member-1', name: 'Ava' },
								{ id: 'member-2', name: 'Mina' },
							],
						}),
					}),
				};
			}
			if (selectIndex === 3) {
				return {
					from: () => ({
						where: async () => [],
					}),
				};
			}
			// selectIndex === 4: wgChoresSnapshot used for fair rotation.
			return {
				from: () => ({
					where: async () => [
						{ assignedMemberId: 'member-1', nextDueAt: new Date('2026-05-01T00:00:00Z') },
						{ assignedMemberId: 'member-1', nextDueAt: new Date('2026-05-08T00:00:00Z') },
					],
				}),
			};
		});
		// Simulate a real, non-zero gap count for member-1 so the test fails
		// if the route ever goes back to hardcoding openGapCountForAssignee: 0.
		fairnessMock.computeOpenGapsByMember.mockReturnValue(new Map([['member-1', 2]]));
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: choreId, assignedMemberId: 'member-2' }],
				}),
			}),
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [{ id: 'completion-1' }],
			}),
		});

		await POST(
			new NextRequest(`https://mana.test/api/wg/ABCDEFGH/chores/${choreId}/complete`, {
				method: 'POST',
			}),
			{ params: Promise.resolve({ code: 'ABCDEFGH', id: choreId }) },
		);

		expect(fairnessMock.chooseNextAvailableMember).toHaveBeenCalledTimes(1);
		const call = fairnessMock.chooseNextAvailableMember.mock.calls[0]?.[0] as {
			chores: { assignedMemberId: string | null; openGapCountForAssignee: number }[];
		};
		expect(
			call.chores.every(
				(c) => c.assignedMemberId !== 'member-1' || c.openGapCountForAssignee === 2,
			),
		).toBe(true);
	});

	it('RED BUG-549: rate-limits chore completion before rotating assignee', async () => {
		const { POST } = await import('./route');
		const choreId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => {
			selectIndex += 1;
			if (selectIndex === 1) {
				return {
					from: () => ({
						innerJoin: () => ({
							where: () => ({
								limit: async () => [
									{
										id: choreId,
										wgId: 'wg-1',
										intervalDays: 7,
										recurrenceType: 'days',
										title: 'Bad putzen',
										assignedMemberId: 'member-1',
										nextDueAt: new Date('2026-05-20T00:00:00Z'),
									},
								],
							}),
						}),
					}),
				};
			}
			if (selectIndex === 2) {
				return {
					from: () => ({
						where: () => ({
							orderBy: async () => [
								{ id: 'member-1', name: 'Ava' },
								{ id: 'member-2', name: 'Mina' },
							],
						}),
					}),
				};
			}
			if (selectIndex === 3) {
				return {
					from: () => ({
						where: async () => [],
					}),
				};
			}
			const snapshot = Promise.resolve([]) as unknown as Promise<unknown[]> & {
				catch: Promise<unknown[]>['catch'];
				from: () => unknown;
				where: () => unknown;
			};
			snapshot.from = () => snapshot;
			snapshot.where = () => snapshot;
			return snapshot;
		});
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: choreId, assignedMemberId: 'member-2' }],
				}),
			}),
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [{ id: 'completion-1' }],
			}),
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/ABCDEFGH/chores/${choreId}/complete`, {
				method: 'POST',
			}),
			{ params: Promise.resolve({ code: 'ABCDEFGH', id: choreId }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'chore:wg-1:member-1',
		);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
