import { resetRouteHarness, routeDb, routeMocks, tableNameOf } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

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
					delete: (...args: unknown[]) => routeDb.delete(...args),
					insert: (...args: unknown[]) => routeDb.insert(...args),
					select: (...args: unknown[]) => routeDb.select(...args),
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

// This suite asserts the 429 path, so the limiter is stubbed rather than left
// to fail open like the shared harness does.
vi.mock('@/core/rate-limit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/core/rate-limit')>()),
	checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
	clientIpKey: () => 'spoofed-ip',
	wgWriteLimiter: {},
}));

describe('expense item route', () => {
	beforeEach(() => {
		resetRouteHarness();
		txMock.committed = false;
		txMock.rolledBack = false;
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: -1, reset: 0 });
	});

	it('returns field-specific validation errors for expense updates before auth or db work', async () => {
		const { PATCH } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { imageUrl: 'x'.repeat(2049) }, error: 'image_invalid' },
			{ body: { expectedUpdatedAt: 'gestern' }, error: 'expected_updated_at_invalid' },
			{ body: { currency: 'EURO' }, error: 'currency_invalid' },
		];

		for (const testCase of cases) {
			const res = await PATCH(
				new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
					method: 'PATCH',
					body: JSON.stringify(testCase.body),
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: testCase.error });
		}
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('rejects an amount change without a replacement splits array before auth or db work', async () => {
		// RED BUG: amountCents alone (no splits) used to update expenses.amountCents
		// while leaving the old expenseSplits rows untouched, desyncing the stored
		// total from sum(expenseSplits.amountCents) — the invariant every balance
		// calculation relies on.
		const { PATCH } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'PATCH',
				body: JSON.stringify({ amountCents: 999 }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'splits_required_with_amount' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('records deleted expense details in the audit trail', async () => {
		const { DELETE } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => ({
			from: () => ({
				where: () => ({
					limit: async () => {
						selectIndex += 1;
						if (selectIndex === 1) return [{ id: 'wg-1' }];
						return [
							{
								paidByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
								description: 'Internet',
								amountCents: 3290,
							},
						];
					},
				}),
			}),
		}));
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: expenseId }],
			}),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Ava', verified: true },
		});
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: true });
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith({
			wgId: 'wg-1',
			memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			eventType: 'expense.deleted',
			entityType: 'expense',
			entityId: expenseId,
			summary: 'Ava hat Internet entfernt.',
			metadata: {
				description: 'Internet',
				amountCents: 3290,
			},
		});
	});

	it('RED BUG-207-EXPENSE: rate-limits expense deletion by WG and member, not spoofable IP only', async () => {
		const { DELETE } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => ({
			from: () => ({
				where: () => ({
					limit: async () => {
						selectIndex += 1;
						if (selectIndex === 1) return [{ id: 'wg-1' }];
						return [
							{
								paidByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
								description: 'Internet',
								amountCents: 3290,
							},
						];
					},
				}),
			}),
		}));
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: expenseId }],
			}),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Ava', verified: true },
		});
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);

		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'DELETE',
				headers: { 'x-forwarded-for': '1.2.3.4' },
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(res.status).toBe(200);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			expect.anything(),
			'expense:wg-1:7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		);
	});

	it('does not replace splits or report success when an expense update returns no row', async () => {
		const { PATCH } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => ({
			from: (table: unknown) => ({
				where: () => {
					if (tableNameOf(table) === 'wg_members') {
						return Promise.resolve([{ id: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' }]);
					}
					if (tableNameOf(table) === 'expense_splits') {
						return Promise.resolve([]);
					}
					return {
						limit: async () => {
							selectIndex += 1;
							if (selectIndex === 1) return [{ id: 'wg-1' }];
							return [
								{
									paidByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
									amountCents: 3290,
									updatedAt: new Date('2026-05-20T10:00:00.000Z'),
								},
							];
						},
					};
				},
			}),
		}));
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [],
				}),
			}),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Ava', verified: true },
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					description: 'Internet neu',
					amountCents: 3290,
					splits: [
						{
							debtorMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
							amountCents: 3290,
						},
					],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: 'expense_not_found' });
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('rejects replacement splits that include members outside the WG', async () => {
		const { PATCH } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const outsiderId = '5d8b3c96-ea3f-4dfc-9db4-b2d1441d8d99';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => ({
			from: () => ({
				where: () => ({
					limit: async () => {
						selectIndex += 1;
						if (selectIndex === 1) return [{ id: 'wg-1' }];
						return [
							{
								paidByMemberId: memberId,
								amountCents: 3290,
								updatedAt: new Date('2026-05-20T10:00:00.000Z'),
							},
						];
					},
				}),
			}),
			where: async () => [{ id: memberId }],
		}));
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Ava', verified: true },
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					amountCents: 3290,
					splits: [
						{ debtorMemberId: memberId, amountCents: 1645 },
						{ debtorMemberId: outsiderId, amountCents: 1645 },
					],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'member_not_in_wg' });
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('checks replacement split sums against the existing amount when amount is unchanged', async () => {
		const { PATCH } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => ({
			from: () => ({
				where: () => ({
					limit: async () => {
						selectIndex += 1;
						if (selectIndex === 1) return [{ id: 'wg-1' }];
						return [
							{
								paidByMemberId: memberId,
								amountCents: 3290,
								updatedAt: new Date('2026-05-20T10:00:00.000Z'),
							},
						];
					},
				}),
			}),
		}));
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Ava', verified: true },
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					splits: [{ debtorMemberId: memberId, amountCents: 1200 }],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'splits_sum_mismatch' });
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('rejects duplicate replacement split debtors before auth or db work when amount is omitted', async () => {
		const { PATCH } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					splits: [
						{ debtorMemberId: memberId, amountCents: 1000 },
						{ debtorMemberId: memberId, amountCents: 2290 },
					],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'splits_duplicate_debtor' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('preserves settledAt only for replacement splits with unchanged debtor and amount', async () => {
		const { PATCH } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const otherMemberId = '5d8b3c96-ea3f-4dfc-9db4-b2d1441d8d99';
		const settledAt = new Date('2026-05-20T10:00:00.000Z');
		let selectIndex = 0;
		let insertedValues: unknown;
		routeDb.select.mockImplementation(() => ({
			from: (table: unknown) => ({
				where: () => {
					if (tableNameOf(table) === 'wg_members') {
						return Promise.resolve([{ id: memberId }, { id: otherMemberId }]);
					}
					if (tableNameOf(table) === 'expense_splits') {
						return Promise.resolve([
							{ debtorMemberId: memberId, amountCents: 1645, settledAt },
							{ debtorMemberId: otherMemberId, amountCents: 1645, settledAt },
						]);
					}
					return {
						limit: async () => {
							selectIndex += 1;
							if (selectIndex === 1) return [{ id: 'wg-1' }];
							if (selectIndex === 2) {
								return [
									{
										paidByMemberId: memberId,
										amountCents: 3290,
										updatedAt: new Date('2026-05-20T10:00:00.000Z'),
									},
								];
							}
							return [
								{
									id: expenseId,
									description: 'Internet',
									amountCents: 3290,
									updatedAt: new Date('2026-05-20T10:00:00.000Z'),
								},
							];
						},
					};
				},
			}),
		}));
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: expenseId }],
				}),
			}),
		});
		routeDb.delete.mockReturnValue({ where: () => Promise.resolve([]) });
		routeDb.insert.mockReturnValue({
			values: (values: unknown) => {
				insertedValues = values;
				return { returning: async () => [{ expenseId }] };
			},
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId, name: 'Ava', verified: true },
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					splits: [
						{ debtorMemberId: memberId, amountCents: 1645 },
						{ debtorMemberId: otherMemberId, amountCents: 1645 },
					],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(res.status).toBe(200);
		expect(insertedValues).toEqual([
			{ expenseId, debtorMemberId: memberId, amountCents: 1645, settledAt },
			{ expenseId, debtorMemberId: otherMemberId, amountCents: 1645, settledAt },
		]);

		insertedValues = undefined;
		selectIndex = 0;
		const changedAmountRes = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					splits: [
						{ debtorMemberId: memberId, amountCents: 1600 },
						{ debtorMemberId: otherMemberId, amountCents: 1690 },
					],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(changedAmountRes.status).toBe(200);
		// memberId is the payer (paidByMemberId above) — their own share is never
		// a debt, so a changed amount still lands auto-settled instead of `null`
		// (settledAtForOwnShare), while the other debtor's changed split resets
		// to unsettled as before.
		const changedRows =
			changedAmountRes.status === 200
				? (insertedValues as Array<{
						debtorMemberId: string;
						amountCents: number;
						settledAt: Date | null;
					}>)
				: [];
		const ownRow = changedRows.find((r) => r.debtorMemberId === memberId);
		const otherRow = changedRows.find((r) => r.debtorMemberId === otherMemberId);
		expect(ownRow).toMatchObject({ expenseId, amountCents: 1600 });
		expect(ownRow?.settledAt).toBeInstanceOf(Date);
		expect(otherRow).toEqual({
			expenseId,
			debtorMemberId: otherMemberId,
			amountCents: 1690,
			settledAt: null,
		});
	});

	it('does not audit or report success when replacing expense splits returns no rows', async () => {
		const { PATCH } = await import('./route');
		const expenseId = '492a85d5-3232-4faf-a2dc-552165aa4dec';
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => ({
			from: (table: unknown) => ({
				where: () => {
					if (tableNameOf(table) === 'wg_members') {
						return Promise.resolve([{ id: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' }]);
					}
					if (tableNameOf(table) === 'expense_splits') {
						return Promise.resolve([]);
					}
					return {
						limit: async () => {
							selectIndex += 1;
							if (selectIndex === 1) return [{ id: 'wg-1' }];
							return [
								{
									paidByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
									amountCents: 3290,
									updatedAt: new Date('2026-05-20T10:00:00.000Z'),
								},
							];
						},
					};
				},
			}),
		}));
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: expenseId }],
				}),
			}),
		});
		routeDb.delete.mockReturnValue({
			where: () => Promise.resolve([]),
		});
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [],
			}),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Ava', verified: true },
		});

		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/expenses/${expenseId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					description: 'Internet neu',
					amountCents: 3290,
					splits: [
						{
							debtorMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
							amountCents: 3290,
						},
					],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: expenseId }) },
		);

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: 'split_insert_failed' });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		// The delete of the old splits and the amount change disappear with the
		// rollback. Before, they were undone by re-inserting a snapshot taken
		// beforehand — a best-effort repair that left the expense with zero
		// splits, and every balance wrong, whenever it failed itself.
		expect(txMock.rolledBack).toBe(true);
		expect(txMock.committed).toBe(false);
	});
});
