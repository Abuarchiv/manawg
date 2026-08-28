import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const idempotencyMock = vi.hoisted(() => ({
	claimResponseSlot: vi.fn(),
	getCachedResponse: vi.fn(),
	readIdempotencyKey: vi.fn(),
	setCachedResponse: vi.fn(),
}));

const adminMock = vi.hoisted(() => ({ isVerifiedWgAdmin: vi.fn() }));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'write' },
}));

const recurringMock = vi.hoisted(() => ({
	buildRecurringAdvance: vi.fn(),
	parseRecurringSplits: vi.fn(),
	recurringDueDateMatchesExpected: vi.fn(),
	recurringSplitsMatchAmount: vi.fn(),
}));

vi.mock('@/lib/idempotency', () => ({
	claimResponseSlot: (...args: unknown[]) => idempotencyMock.claimResponseSlot(...args),
	getCachedResponse: (...args: unknown[]) => idempotencyMock.getCachedResponse(...args),
	readIdempotencyKey: (...args: unknown[]) => idempotencyMock.readIdempotencyKey(...args),
	setCachedResponse: (...args: unknown[]) => idempotencyMock.setCachedResponse(...args),
}));

// Stubbed rather than left to fail open, because this suite asserts the 429.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/lib/rate-limit')>()),
	checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
	wgWriteLimiter: rateLimitMock.wgWriteLimiter,
}));

vi.mock('@/lib/wg/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

vi.mock('@/lib/wg/recurring-expenses', () => ({
	buildRecurringAdvance: (...args: unknown[]) => recurringMock.buildRecurringAdvance(...args),
	parseRecurringSplits: (...args: unknown[]) => recurringMock.parseRecurringSplits(...args),
	recurringDueDateMatchesExpected: (...args: unknown[]) =>
		recurringMock.recurringDueDateMatchesExpected(...args),
	recurringSplitsMatchAmount: (...args: unknown[]) =>
		recurringMock.recurringSplitsMatchAmount(...args),
}));

function mockSelectResponses(...responses: unknown[][]): void {
	let index = 0;
	routeDb.select.mockImplementation(() => ({
		from: () => {
			let consumed = false;
			const consumeOnce = (): unknown[] => {
				if (consumed) return [];
				consumed = true;
				return responses[index++] ?? [];
			};
			const limitFn = async (): Promise<unknown[]> => consumeOnce();
			const whereResult = new Proxy(limitFn, {
				get(_target, prop) {
					if (prop === 'limit') return limitFn;
					if (prop === 'then') {
						return (resolve: (value: unknown[]) => unknown) =>
							Promise.resolve(consumeOnce()).then(resolve);
					}
					return undefined;
				},
			});
			return { where: () => whereResult };
		},
	}));
}

describe('recurring expenses route', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.resetModules();
		idempotencyMock.readIdempotencyKey.mockReturnValue(null);
		idempotencyMock.getCachedResponse.mockResolvedValue(null);
		idempotencyMock.claimResponseSlot.mockResolvedValue(true);
		idempotencyMock.setCachedResponse.mockResolvedValue(undefined);
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Ava', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(false);
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		recurringMock.buildRecurringAdvance.mockReturnValue({
			nextDueAt: new Date('2026-07-01T00:00:00.000Z'),
			lastCreatedAt: new Date('2026-06-01T00:00:00.000Z'),
			updatedAt: new Date('2026-05-20T10:00:00.000Z'),
		});
		recurringMock.recurringDueDateMatchesExpected.mockReturnValue(true);
		recurringMock.recurringSplitsMatchAmount.mockReturnValue(true);
	});

	it('deletes a recurring template and records an audit event', async () => {
		const { DELETE } = await import('./route');
		const recurringId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
		const nextDueAt = new Date('2026-06-01T00:00:00.000Z');
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					id: recurringId,
					createdByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					description: 'Internet',
					amountCents: 3290,
					intervalMonths: 1,
					nextDueAt,
				},
			],
		);
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: recurringId }],
			}),
		});

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'DELETE',
				body: JSON.stringify({ id: recurringId }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: true });
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith({
			wgId: 'wg-1',
			memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			eventType: 'recurring.deleted',
			entityType: 'recurring_expense',
			entityId: recurringId,
			summary: 'Ava hat die Fixkosten-Vorlage Internet gelöscht.',
			metadata: {
				description: 'Internet',
				amountCents: 3290,
				intervalMonths: 1,
				nextDueAt: '2026-06-01T00:00:00.000Z',
			},
		});
	});

	it('forbids legacy body-id deletes by non-owner non-admin members', async () => {
		const { DELETE } = await import('./route');
		const recurringId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
		const callerId = '11111111-1111-1111-1111-111111111111';
		const ownerId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerId, name: 'Ben', verified: true },
		});
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					id: recurringId,
					createdByMemberId: ownerId,
					description: 'Internet',
					amountCents: 3290,
					intervalMonths: 1,
					nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
				},
			],
		);

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'DELETE',
				body: JSON.stringify({ id: recurringId }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(adminMock.isVerifiedWgAdmin).toHaveBeenCalledWith('wg-1', callerId, true);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-389: rate-limits legacy body-id recurring deletes before deleting data', async () => {
		const { DELETE } = await import('./route');
		const recurringId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
		const nextDueAt = new Date('2026-06-01T00:00:00.000Z');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		recurringMock.parseRecurringSplits.mockReturnValue([
			{
				debtorMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
				amountCents: 3290,
			},
		]);
		mockSelectResponses(
			[{ id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT' }],
			[
				{
					id: recurringId,
					createdByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					description: 'Internet',
					amountCents: 3290,
					intervalMonths: 1,
					nextDueAt,
				},
			],
		);
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: recurringId }],
			}),
		});

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'DELETE',
				body: JSON.stringify({ id: recurringId }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'recurring-expense:wg-1:7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('returns field-specific validation errors when creating recurring templates', async () => {
		const { POST } = await import('./route');
		const validBody = {
			description: 'Internet',
			amountCents: 3290,
			paidByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			intervalMonths: 1,
			nextDueAt: '2026-06-01T00:00:00.000Z',
			splits: [{ debtorMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', amountCents: 3290 }],
		};

		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { ...validBody, description: '' }, error: 'description_invalid' },
			{ body: { ...validBody, amountCents: 0 }, error: 'amount_invalid' },
			{ body: { ...validBody, paidByMemberId: 'not-a-uuid' }, error: 'member_id_invalid' },
			{ body: { ...validBody, intervalMonths: 0 }, error: 'interval_invalid' },
			{ body: { ...validBody, nextDueAt: 'morgen' }, error: 'due_date_invalid' },
			{ body: { ...validBody, splits: [] }, error: 'splits_invalid' },
		];

		for (const testCase of cases) {
			const res = await POST(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
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

	it('rejects duplicate debtors when creating recurring templates before auth or db work', async () => {
		const { POST } = await import('./route');
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'POST',
				body: JSON.stringify({
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: memberId,
					intervalMonths: 1,
					nextDueAt: '2026-06-01T00:00:00.000Z',
					splits: [
						{ debtorMemberId: memberId, amountCents: 1000 },
						{ debtorMemberId: memberId, amountCents: 2290 },
					],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'splits_duplicate_debtor' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('rate-limits recurring template creation after member auth before write queries', async () => {
		const { POST } = await import('./route');
		const callerId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 0,
		});
		mockSelectResponses([{ id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT' }]);

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'POST',
				headers: { 'x-manawg-member-id': callerId },
				body: JSON.stringify({
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: callerId,
					intervalMonths: 1,
					nextDueAt: '2026-06-01T00:00:00.000Z',
					splits: [{ debtorMemberId: callerId, amountCents: 3290 }],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'recurring-expense:wg-1:7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('returns field-specific validation errors when updating recurring templates', async () => {
		const { PATCH } = await import('./route');
		const recurringId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
		const validSplit = {
			debtorMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			amountCents: 3290,
		};

		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { id: recurringId, description: '' }, error: 'description_invalid' },
			{ body: { id: recurringId, amountCents: 0 }, error: 'amount_invalid' },
			{ body: { id: recurringId, paidByMemberId: 'not-a-uuid' }, error: 'member_id_invalid' },
			{ body: { id: recurringId, intervalMonths: 0 }, error: 'interval_invalid' },
			{ body: { id: recurringId, nextDueAt: 'morgen' }, error: 'due_date_invalid' },
			{ body: { id: recurringId, expectedNextDueAt: 'gestern' }, error: 'due_date_invalid' },
			{ body: { id: recurringId, splits: [] }, error: 'splits_invalid' },
			{
				body: { id: recurringId, splits: [{ ...validSplit, debtorMemberId: 'x' }] },
				error: 'splits_invalid',
			},
		];

		for (const testCase of cases) {
			const res = await PATCH(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
					method: 'PATCH',
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

	it('requires an expected due date before advancing a recurring template', async () => {
		const { PATCH } = await import('./route');
		const recurringId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'PATCH',
				body: JSON.stringify({ id: recurringId }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'due_date_invalid' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('rejects manual advance for paused recurring templates', async () => {
		const { PATCH } = await import('./route');
		const recurringId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
		mockSelectResponses(
			[{ id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT' }],
			[
				{
					id: recurringId,
					createdByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					intervalMonths: 1,
					nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
					pausedAt: new Date('2026-05-20T10:00:00.000Z'),
					splitsJson: '[]',
				},
			],
		);

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'PATCH',
				body: JSON.stringify({
					id: recurringId,
					expectedNextDueAt: '2026-06-01T00:00:00.000Z',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'abo_paused' });
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('returns not_found when a recurring template disappears before advance update', async () => {
		const { PATCH } = await import('./route');
		const recurringId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
		mockSelectResponses(
			[{ id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT' }],
			[
				{
					id: recurringId,
					createdByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					intervalMonths: 1,
					nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
					splitsJson: '[]',
				},
			],
		);
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'PATCH',
				body: JSON.stringify({
					id: recurringId,
					expectedNextDueAt: '2026-06-01T00:00:00.000Z',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: 'recurring_expense_not_found' });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('forbids legacy body-id template updates by non-owner non-admin members', async () => {
		const { PATCH } = await import('./route');
		const recurringId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
		const callerId = '11111111-1111-1111-1111-111111111111';
		const ownerId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: callerId, name: 'Ben', verified: true },
		});
		mockSelectResponses(
			[{ id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT' }],
			[
				{
					id: recurringId,
					createdByMemberId: ownerId,
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: ownerId,
					intervalMonths: 1,
					nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
					splitsJson: '[]',
				},
			],
		);

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'PATCH',
				body: JSON.stringify({ id: recurringId, description: 'Internet neu' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(adminMock.isVerifiedWgAdmin).toHaveBeenCalledWith('wg-1', callerId, true);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-392: rate-limits legacy body-id recurring updates before updating data', async () => {
		const { PATCH } = await import('./route');
		const recurringId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		recurringMock.parseRecurringSplits.mockReturnValue([
			{
				debtorMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
				amountCents: 3290,
			},
		]);
		mockSelectResponses(
			[{ id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT' }],
			[
				{
					id: recurringId,
					createdByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					intervalMonths: 1,
					nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
					splitsJson: '[]',
				},
			],
			[{ id: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' }],
		);
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [
						{
							id: recurringId,
							createdByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
							description: 'Internet neu',
							amountCents: 3290,
							paidByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
							intervalMonths: 1,
							nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
							lastCreatedAt: null,
							pausedAt: null,
							createdAt: new Date('2026-05-01T00:00:00.000Z'),
							splitsJson: JSON.stringify([
								{
									debtorMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
									amountCents: 3290,
								},
							]),
						},
					],
				}),
			}),
		});

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'PATCH',
				body: JSON.stringify({ id: recurringId, description: 'Internet neu' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'recurring-expense:wg-1:7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('returns id_invalid when deleting a recurring template with a malformed id', async () => {
		const { DELETE } = await import('./route');

		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'DELETE',
				body: JSON.stringify({ id: 'not-a-uuid' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'id_invalid' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('RED BUG: dedupes concurrent recurring-template creates sharing an Idempotency-Key', async () => {
		const { POST } = await import('./route');
		const callerId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const wgRow = { id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT' };

		idempotencyMock.readIdempotencyKey.mockReturnValue('fixed-idem-key');
		recurringMock.parseRecurringSplits.mockReturnValue([
			{ debtorMemberId: callerId, amountCents: 3290 },
		]);

		// Select call sequence:
		//   call 1: resolveWg (WG_ROW) -> memberIds-in-wg check (memberRow)
		//   call 2: resolveWg (WG_ROW) -> local ReplayCache hits before the
		//           memberIds select runs again, so no further stages are consumed.
		mockSelectResponses([wgRow], [{ id: callerId }], [wgRow]);

		routeDb.insert.mockReturnValue({
			values: vi.fn(() => ({
				returning: vi.fn().mockResolvedValue([
					{
						id: 'a1ef32d5-d40a-4df2-9977-7684dce7df3f',
						wgId: 'wg-1',
						createdByMemberId: callerId,
						paidByMemberId: callerId,
						description: 'Internet',
						amountCents: 3290,
						intervalMonths: 1,
						nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
						lastCreatedAt: null,
						pausedAt: null,
						createdAt: new Date('2026-05-20T10:00:00.000Z'),
						splitsJson: JSON.stringify([{ debtorMemberId: callerId, amountCents: 3290 }]),
					},
				]),
			})),
		});

		const makeRequest = () =>
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'POST',
				headers: { 'x-manawg-member-id': callerId, 'Idempotency-Key': 'fixed-idem-key' },
				body: JSON.stringify({
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: callerId,
					intervalMonths: 1,
					nextDueAt: '2026-06-01T00:00:00.000Z',
					splits: [{ debtorMemberId: callerId, amountCents: 3290 }],
				}),
			});

		const first = await POST(makeRequest(), { params: Promise.resolve({ code: 'MTE8PZAT' }) });
		const second = await POST(makeRequest(), { params: Promise.resolve({ code: 'MTE8PZAT' }) });

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		const firstBody = await first.json();
		const secondBody = await second.json();
		expect(routeDb.insert).toHaveBeenCalledTimes(1);
		expect(secondBody).toEqual(firstBody);
		expect(idempotencyMock.setCachedResponse).toHaveBeenCalledTimes(1);
	});

	it('scopes the idempotency replay cache per member so a shared key does not cross members', async () => {
		const { POST } = await import('./route');
		const memberA = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const memberB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const wgRow = { id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT' };
		const templateIds = [
			'a1ef32d5-d40a-4df2-9977-7684dce7df3f',
			'b2ef32d5-d40a-4df2-9977-7684dce7df3f',
		];

		idempotencyMock.readIdempotencyKey.mockReturnValue('shared-client-key');
		recurringMock.parseRecurringSplits.mockImplementation(
			(json: string) => JSON.parse(json) as unknown[],
		);
		routeMocks.requireMember
			.mockResolvedValueOnce({
				ok: true,
				member: { memberId: memberA, name: 'Ava', verified: true },
			})
			.mockResolvedValueOnce({
				ok: true,
				member: { memberId: memberB, name: 'Ben', verified: true },
			});

		// Each request runs its own resolveWg + memberIds-in-wg select, since a
		// per-member scope means neither request can hit the other's replay
		// cache entry: call1/2 = request A (resolveWg, memberIds check), call3/4
		// = request B (resolveWg, memberIds check).
		mockSelectResponses([wgRow], [{ id: memberA }], [wgRow], [{ id: memberB }]);

		let insertCount = 0;
		routeDb.insert.mockImplementation(() => ({
			values: vi.fn(() => ({
				returning: vi.fn().mockImplementation(async () => {
					const id = templateIds[insertCount] ?? templateIds[0];
					const memberId = insertCount === 0 ? memberA : memberB;
					insertCount += 1;
					return [
						{
							id,
							wgId: 'wg-1',
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Internet',
							amountCents: 3290,
							intervalMonths: 1,
							nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
							lastCreatedAt: null,
							pausedAt: null,
							createdAt: new Date('2026-05-20T10:00:00.000Z'),
							splitsJson: JSON.stringify([{ debtorMemberId: memberId, amountCents: 3290 }]),
						},
					];
				}),
			})),
		}));

		const makeRequest = (memberId: string) =>
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'POST',
				headers: { 'x-manawg-member-id': memberId, 'Idempotency-Key': 'shared-client-key' },
				body: JSON.stringify({
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: memberId,
					intervalMonths: 1,
					nextDueAt: '2026-06-01T00:00:00.000Z',
					splits: [{ debtorMemberId: memberId, amountCents: 3290 }],
				}),
			});

		const resA = await POST(makeRequest(memberA), {
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		});
		const resB = await POST(makeRequest(memberB), {
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		});

		expect(resA.status).toBe(200);
		expect(resB.status).toBe(200);
		const bodyA = await resA.json();
		const bodyB = await resB.json();
		expect(routeDb.insert).toHaveBeenCalledTimes(2);
		expect(bodyA).not.toEqual(bodyB);
		expect(bodyA.recurringExpense.id).toBe(templateIds[0]);
		expect(bodyB.recurringExpense.id).toBe(templateIds[1]);
		expect(idempotencyMock.setCachedResponse).toHaveBeenCalledTimes(2);
	});

	it('waits for a claimed idempotency response instead of inserting a duplicate recurring template', async () => {
		vi.useFakeTimers();
		try {
			const { POST } = await import('./route');
			const callerId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
			const wgRow = { id: 'wg-1', name: 'WG', shareCode: 'MTE8PZAT' };
			const cachedBody = {
				recurringExpense: {
					id: 'a1ef32d5-d40a-4df2-9977-7684dce7df3f',
					wgId: 'wg-1',
					createdByMemberId: callerId,
					paidByMemberId: callerId,
					description: 'Internet',
					amountCents: 3290,
					intervalMonths: 1,
					nextDueAt: '2026-06-01T00:00:00.000Z',
					lastCreatedAt: null,
					pausedAt: null,
					createdAt: '2026-05-20T10:00:00.000Z',
					splits: [{ debtorMemberId: callerId, amountCents: 3290 }],
				},
			};

			idempotencyMock.readIdempotencyKey.mockReturnValue('retry-key');
			idempotencyMock.claimResponseSlot.mockResolvedValue(false);
			idempotencyMock.getCachedResponse
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(cachedBody);
			recurringMock.parseRecurringSplits.mockReturnValue([
				{ debtorMemberId: callerId, amountCents: 3290 },
			]);
			mockSelectResponses([wgRow], [{ id: callerId }]);

			const responsePromise = POST(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/recurring-expenses', {
					method: 'POST',
					headers: { 'x-manawg-member-id': callerId, 'Idempotency-Key': 'retry-key' },
					body: JSON.stringify({
						description: 'Internet',
						amountCents: 3290,
						paidByMemberId: callerId,
						intervalMonths: 1,
						nextDueAt: '2026-06-01T00:00:00.000Z',
						splits: [{ debtorMemberId: callerId, amountCents: 3290 }],
					}),
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
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
