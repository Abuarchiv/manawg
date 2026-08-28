import { resetRouteHarness, routeDb, routeMocks, tableNameOf } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CRON_SECRET = 'test-secret';
const AUTH_HEADER = { authorization: `Bearer ${CRON_SECRET}` };

/**
 * Stands in for a real transaction: the callback writes through the same db
 * mock, and a throwing callback rolls back instead of committing.
 */
const txMock = vi.hoisted(() => ({ committed: false, rolledBack: false }));

vi.mock('@/lib/db/transaction', async () => {
	const { TransactionAbort } = await import('@/lib/db/transaction-abort');
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

const RECURRING_ID = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const SPLITS = [{ debtorMemberId: MEMBER_ID, amountCents: 1799 }];

function buildDueRow(overrides: Record<string, unknown> = {}) {
	return {
		id: RECURRING_ID,
		wgId: 'wg-1',
		paidByMemberId: MEMBER_ID,
		description: 'Netflix',
		amountCents: 1799,
		intervalMonths: 1,
		nextDueAt: new Date('2026-05-20T00:00:00.000Z'),
		splitsJson: JSON.stringify(SPLITS),
		wgName: 'WG Berlin',
		shareCode: 'MTE8PZAT',
		...overrides,
	};
}

function mockDueSelect(rows: ReturnType<typeof buildDueRow>[]): void {
	routeDb.select.mockReturnValue({
		from: vi.fn(() => ({
			innerJoin: vi.fn(() => ({
				where: vi.fn().mockResolvedValue(rows),
			})),
		})),
	});
}

describe('recurring-advance cron route', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.unstubAllEnvs();
		txMock.committed = false;
		txMock.rolledBack = false;
		// Pin "now" so the number of missed periods stays deterministic
		// regardless of the real date the suite runs on.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns 503 when CRON_SECRET is missing (fail-closed)', async () => {
		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://mana.test/api/cron/recurring-advance'));
		expect(res.status).toBe(503);
	});

	it('returns 401 when CRON_SECRET is set but no Bearer header', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://mana.test/api/cron/recurring-advance'));
		expect(res.status).toBe(401);
	});

	it('returns ok with 0 when no recurring expenses are due', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		mockDueSelect([]);
		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest('https://mana.test/api/cron/recurring-advance', {
				headers: AUTH_HEADER,
			}),
		);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, charged: 0 });
	});

	it('creates expenses + splits, advances templates, and dispatches notifications', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		mockDueSelect([buildDueRow()]);
		const insertExpenseChain = {
			values: vi.fn(() => ({
				returning: vi.fn().mockResolvedValue([{ id: 'expense-1' }]),
			})),
		};
		const insertSplitsChain = { values: vi.fn().mockResolvedValue(undefined) };
		routeDb.insert.mockReturnValueOnce(insertExpenseChain).mockReturnValueOnce(insertSplitsChain);
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
		});
		routeMocks.dispatchNotification.mockResolvedValue(undefined);
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);

		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest('https://mana.test/api/cron/recurring-advance', {
				headers: AUTH_HEADER,
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, charged: 1 });
		expect(routeMocks.dispatchNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'expense.recurring_charged',
				payload: expect.objectContaining({
					description: 'Netflix',
					amountCents: 1799,
					expenseId: 'expense-1',
				}),
			}),
		);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'recurring.charged' }),
		);
	});

	it('skips duplicate inserts when the unique constraint trips (idempotent)', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		mockDueSelect([buildDueRow()]);
		const insertExpenseChain = {
			values: vi.fn(() => ({
				returning: vi
					.fn()
					.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' })),
			})),
		};
		routeDb.insert.mockReturnValueOnce(insertExpenseChain);
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
		});

		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest('https://mana.test/api/cron/recurring-advance', {
				headers: AUTH_HEADER,
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, charged: 0 });
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});

	/**
	 * The cron runs unattended, so an orphaned expense here is never noticed by
	 * a user reacting to an error — it just skews the balances of a WG that
	 * nobody was even looking at. The old code compensated with a delete, which
	 * is itself a database call and left the orphan behind when it failed.
	 */
	it('rolls the expense back when its splits cannot be written', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		mockDueSelect([buildDueRow()]);
		routeDb.insert.mockImplementation((table: { id?: string }) => {
			if (tableNameOf(table) === 'expenses') {
				return {
					values: vi.fn(() => ({
						returning: vi.fn().mockResolvedValue([{ id: 'expense-1' }]),
					})),
				};
			}
			return { values: vi.fn().mockRejectedValue(new Error('splits unreachable')) };
		});
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
		});

		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest('https://mana.test/api/cron/recurring-advance', {
				headers: AUTH_HEADER,
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, charged: 0 });
		expect(txMock.rolledBack).toBe(true);
		expect(txMock.committed).toBe(false);
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});

	it('BUG-020: catches up every missed recurring period in one cron run', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		mockDueSelect([
			buildDueRow({
				nextDueAt: new Date('2026-02-20T00:00:00.000Z'),
			}),
		]);
		let expenseInsertCount = 0;
		routeDb.insert.mockImplementation((table: { id?: string }) => {
			if (tableNameOf(table) === 'expenses') {
				expenseInsertCount += 1;
				return {
					values: vi.fn(() => ({
						returning: vi.fn().mockResolvedValue([{ id: `expense-${expenseInsertCount}` }]),
					})),
				};
			}
			return { values: vi.fn().mockResolvedValue(undefined) };
		});
		routeDb.update.mockReturnValue({
			set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
		});
		routeMocks.dispatchNotification.mockResolvedValue(undefined);
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);

		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest('https://mana.test/api/cron/recurring-advance', {
				headers: AUTH_HEADER,
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, charged: 4 });
		expect(expenseInsertCount).toBe(4);
	});
});
