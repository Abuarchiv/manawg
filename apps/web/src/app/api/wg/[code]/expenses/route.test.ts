import {
	authenticateAs,
	queueSelects,
	resetRouteHarness,
	routeDb,
	routeMocks,
	tableNameOf,
} from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const EXPENSE_ID = '492a85d5-3232-4faf-a2dc-552165aa4dec';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'write' },
}));

const idempotencyMock = vi.hoisted(() => ({
	claimResponseSlot: vi.fn(),
	getCachedResponse: vi.fn(),
	readIdempotencyKey: vi.fn(),
	setCachedResponse: vi.fn(),
}));

/**
 * Stands in for a real transaction: the callback gets a handle that records
 * onto the same db stub, and a throwing callback rolls back instead of
 * committing. `TransactionAbort` is the real class, because the route
 * distinguishes a deliberate abort from a driver failure with `instanceof`.
 */
const txMock = vi.hoisted(() => ({ committed: false, rolledBack: false }));

vi.mock('@/lib/db/transaction', async () => {
	const { TransactionAbort } = await import('@/lib/db/transaction-abort');
	return {
		TransactionAbort,
		withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			try {
				// Bound to the harness stub the test configured. Resolving it via a
				// fresh `import()` here would hand back a new module instance under
				// `vi.resetModules()`, i.e. a different set of spies.
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

vi.mock('@/lib/idempotency', () => ({
	claimResponseSlot: (...args: unknown[]) => idempotencyMock.claimResponseSlot(...args),
	getCachedResponse: (...args: unknown[]) => idempotencyMock.getCachedResponse(...args),
	readIdempotencyKey: (...args: unknown[]) => idempotencyMock.readIdempotencyKey(...args),
	setCachedResponse: (...args: unknown[]) => idempotencyMock.setCachedResponse(...args),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/lib/rate-limit')>()),
	checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
	clientIpKey: () => '203.0.113.10',
	wgWriteLimiter: rateLimitMock.wgWriteLimiter,
}));

function expenseRow(id: string): Record<string, unknown> {
	return {
		id,
		wgId: 'wg-1',
		paidByMemberId: CALLER_ID,
		amountCents: 1250,
		currency: 'EUR',
		description: 'Pizza',
		imageUrl: null,
		occurredAt: new Date('2026-05-20T12:00:00.000Z'),
	};
}

/**
 * Route the insert stub by real table name rather than by a stringified schema
 * stub, so renaming a table is a test failure instead of a silent pass.
 */
function mockInserts(handlers: {
	expenses: () => unknown;
	expenseSplits: () => unknown;
	fallback?: () => unknown;
}): void {
	routeDb.insert.mockImplementation((table: unknown) => {
		const name = tableNameOf(table);
		if (name === 'expenses') return handlers.expenses();
		if (name === 'expense_splits') return handlers.expenseSplits();
		return handlers.fallback?.() ?? { values: vi.fn().mockResolvedValue(undefined) };
	});
}

function returning(rows: unknown[]): { values: ReturnType<typeof vi.fn> } {
	return { values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(rows) })) };
}

function postExpense(headers: Record<string, string> = {}): NextRequest {
	return new NextRequest('https://mana.test/api/wg/MTE8PZAT/expenses', {
		method: 'POST',
		headers,
		body: JSON.stringify({
			amountCents: 1250,
			description: 'Pizza',
			splits: [{ debtorMemberId: CALLER_ID, amountCents: 1250 }],
		}),
	});
}

const PARAMS = { params: Promise.resolve({ code: 'MTE8PZAT' }) };

describe('expenses route', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.resetModules();
		txMock.committed = false;
		txMock.rolledBack = false;
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		idempotencyMock.readIdempotencyKey.mockReturnValue(null);
		idempotencyMock.getCachedResponse.mockResolvedValue(null);
		idempotencyMock.claimResponseSlot.mockResolvedValue(true);
		idempotencyMock.setCachedResponse.mockResolvedValue(undefined);
	});

	it('returns field-specific validation errors for expense creation before auth or db work', async () => {
		const { POST } = await import('./route');
		const validBody = {
			paidByMemberId: CALLER_ID,
			amountCents: 1250,
			description: 'Pizza',
			splits: [{ debtorMemberId: CALLER_ID, amountCents: 1250 }],
		};
		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { ...validBody, paidByMemberId: 'not-a-uuid' }, error: 'member_id_invalid' },
			{ body: { ...validBody, currency: 'EURO' }, error: 'currency_invalid' },
			{ body: { ...validBody, imageUrl: 'x'.repeat(2049) }, error: 'image_invalid' },
		];

		for (const testCase of cases) {
			const res = await POST(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/expenses', {
					method: 'POST',
					body: JSON.stringify(testCase.body),
				}),
				PARAMS,
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: testCase.error });
		}
		expect(routeDb.query.wgs.findFirst).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('passes the created expense id to notifications for deep links', async () => {
		const { POST } = await import('./route');
		const announcementValues = vi.fn().mockResolvedValue(undefined);
		authenticateAs(CALLER_ID);
		mockInserts({
			expenses: () => returning([expenseRow(EXPENSE_ID)]),
			expenseSplits: () =>
				returning([{ expenseId: EXPENSE_ID, debtorMemberId: CALLER_ID, amountCents: 1250 }]),
			fallback: () => ({ values: announcementValues }),
		});

		const res = await POST(postExpense({ 'x-manawg-member-id': CALLER_ID }), PARAMS);

		expect(res.status).toBe(200);
		expect(routeMocks.dispatchNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ expenseId: EXPENSE_ID }),
			}),
		);
		expect(announcementValues).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'expense',
				sourcePath: `/ausgaben?highlight=${EXPENSE_ID}`,
			}),
		);
	});

	it('rolls back the expense and skips side effects when split insert returns no rows', async () => {
		const { POST } = await import('./route');
		authenticateAs(CALLER_ID);
		mockInserts({
			expenses: () => returning([expenseRow(EXPENSE_ID)]),
			expenseSplits: () => returning([]),
		});

		const res = await POST(postExpense({ 'x-manawg-member-id': CALLER_ID }), PARAMS);

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: 'split_insert_failed' });
		// The expense disappears with the rollback. It used to be removed by a
		// compensating delete, which was itself a database call and left an
		// orphan behind whenever it failed.
		expect(txMock.rolledBack).toBe(true);
		expect(txMock.committed).toBe(false);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});

	it('rate-limits expense creation after member auth before write queries', async () => {
		const { POST } = await import('./route');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 0,
		});
		authenticateAs(CALLER_ID);

		const res = await POST(postExpense({ 'x-manawg-member-id': CALLER_ID }), PARAMS);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`expense:wg-1:${CALLER_ID}`,
		);
		expect(routeDb.insert).not.toHaveBeenCalled();
	});

	it('RED BUG-003: does not replay an idempotency cache entry before WG/member auth', async () => {
		const { POST } = await import('./route');
		const cachedExpenseId = '11111111-2222-4333-8444-555555555555';
		idempotencyMock.readIdempotencyKey.mockReturnValue('same-client-key');
		idempotencyMock.getCachedResponse.mockResolvedValue({
			expense: {
				id: cachedExpenseId,
				wgId: 'other-wg',
				paidByMemberId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				amountCents: 9999,
				description: 'Cached from other WG',
				splits: [],
			},
		});
		queueSelects([{ id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' }]);
		routeMocks.requireMember.mockResolvedValue({
			ok: false,
			response: Response.json({ error: 'not_a_member' }, { status: 401 }),
		});

		const res = await POST(postExpense({ 'Idempotency-Key': 'same-client-key' }), PARAMS);

		expect(routeMocks.requireMember).toHaveBeenCalled();
		expect(res.status).not.toBe(200);
		await expect(res.json()).resolves.not.toEqual({
			expense: expect.objectContaining({ id: cachedExpenseId, wgId: 'other-wg' }),
		});
	});

	it('RED BUG-002: does not create two expenses when the same idempotency key misses cache twice', async () => {
		const { POST } = await import('./route');
		const expenseIds = [EXPENSE_ID, '2f2770a7-b96e-4c2f-b18c-b69f1d7f7111'];
		let expenseInsertCount = 0;
		idempotencyMock.readIdempotencyKey.mockReturnValue('retry-key');
		const wgRow = { id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' };
		authenticateAs(CALLER_ID, { selects: [[wgRow], [{ id: CALLER_ID }]] });
		mockInserts({
			expenses: () => {
				const id = expenseIds[expenseInsertCount] ?? expenseIds[0];
				expenseInsertCount += 1;
				return returning([expenseRow(id as string)]);
			},
			expenseSplits: () =>
				returning([
					{
						expenseId: expenseIds[Math.max(0, expenseInsertCount - 1)],
						debtorMemberId: CALLER_ID,
						amountCents: 1250,
					},
				]),
		});

		const headers = { 'Idempotency-Key': 'retry-key', 'x-manawg-member-id': CALLER_ID };
		const first = await POST(postExpense(headers), PARAMS);
		const second = await POST(postExpense(headers), PARAMS);

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(expenseInsertCount).toBe(1);
		expect(await second.json()).toEqual(await first.json());
		expect(idempotencyMock.setCachedResponse).toHaveBeenCalledTimes(1);
	});

	it('waits for a claimed idempotency response instead of inserting a duplicate expense', async () => {
		vi.useFakeTimers();
		try {
			const { POST } = await import('./route');
			const cachedBody = {
				expense: {
					id: EXPENSE_ID,
					wgId: 'wg-1',
					paidByMemberId: CALLER_ID,
					amountCents: 1250,
					currency: 'EUR',
					description: 'Pizza',
					imageUrl: null,
					occurredAt: '2026-05-20T12:00:00.000Z',
					createdAt: '2026-05-20T12:00:00.000Z',
					updatedAt: '2026-05-20T12:00:00.000Z',
					splits: [{ debtorMemberId: CALLER_ID, amountCents: 1250 }],
				},
			};

			idempotencyMock.readIdempotencyKey.mockReturnValue('retry-key');
			idempotencyMock.claimResponseSlot.mockResolvedValue(false);
			idempotencyMock.getCachedResponse
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(cachedBody);
			authenticateAs(CALLER_ID);

			const responsePromise = POST(
				postExpense({ 'Idempotency-Key': 'retry-key', 'x-manawg-member-id': CALLER_ID }),
				PARAMS,
			);

			await vi.advanceTimersByTimeAsync(100);
			const response = await responsePromise;

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual(cachedBody);
			expect(idempotencyMock.claimResponseSlot).toHaveBeenCalledTimes(1);
			expect(routeDb.insert).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
