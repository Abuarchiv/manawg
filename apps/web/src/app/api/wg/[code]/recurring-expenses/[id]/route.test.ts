import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const RECURRING_ID = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const SHARE_CODE = 'MTE8PZAT';
const ROUTE_BASE = `https://mana.test/api/wg/${SHARE_CODE}/recurring-expenses/${RECURRING_ID}`;

const adminMock = vi.hoisted(() => ({ isVerifiedWgAdmin: vi.fn() }));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'write' },
}));

const recurringMock = vi.hoisted(() => ({
	parseRecurringSplits: vi.fn(),
	recurringSplitsMatchAmount: vi.fn(),
}));

// Stubbed rather than left to fail open, because this suite asserts the 429.
vi.mock('@/core/rate-limit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/core/rate-limit')>()),
	checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
	wgWriteLimiter: rateLimitMock.wgWriteLimiter,
}));

vi.mock('@/core/guards/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

vi.mock('@/features/expenses/recurring-expenses', () => ({
	parseRecurringSplits: (...args: unknown[]) => recurringMock.parseRecurringSplits(...args),
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

function buildTemplateRow(overrides: Record<string, unknown> = {}) {
	return {
		id: RECURRING_ID,
		wgId: 'wg-1',
		createdByMemberId: MEMBER_ID,
		paidByMemberId: MEMBER_ID,
		description: 'Netflix',
		amountCents: 1799,
		intervalMonths: 1,
		nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
		lastCreatedAt: null,
		pausedAt: null,
		splitsJson: '[]',
		createdAt: new Date('2026-05-01T00:00:00.000Z'),
		updatedAt: new Date('2026-05-01T00:00:00.000Z'),
		...overrides,
	};
}

function mockUpdateReturning(row: ReturnType<typeof buildTemplateRow>): void {
	routeDb.update.mockReturnValue({
		set: () => ({
			where: () => ({
				returning: async () => [row],
			}),
		}),
	});
}

describe('recurring expense item route', () => {
	beforeEach(() => {
		resetRouteHarness();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: MEMBER_ID, name: 'Ava', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(false);
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		recurringMock.parseRecurringSplits.mockReturnValue([
			{ debtorMemberId: MEMBER_ID, amountCents: 1799 },
		]);
		recurringMock.recurringSplitsMatchAmount.mockReturnValue(true);
	});

	it('rejects malformed ids on GET', async () => {
		const { GET } = await import('./route');
		const res = await GET(new NextRequest(ROUTE_BASE.replace(RECURRING_ID, 'not-a-uuid')), {
			params: Promise.resolve({ code: SHARE_CODE, id: 'not-a-uuid' }),
		});
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'id_invalid' });
	});

	it('returns a single recurring template on GET', async () => {
		const { GET } = await import('./route');
		mockSelectResponses([{ id: 'wg-1' }], [buildTemplateRow()]);
		const res = await GET(new NextRequest(ROUTE_BASE), {
			params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			recurringExpense: { id: string; pausedAt: string | null };
		};
		expect(body.recurringExpense.id).toBe(RECURRING_ID);
		expect(body.recurringExpense.pausedAt).toBeNull();
	});

	it('pauses a recurring template and records an audit event', async () => {
		const { PATCH } = await import('./route');
		mockSelectResponses([{ id: 'wg-1' }], [buildTemplateRow()], [{ id: MEMBER_ID }]);
		const pausedAt = new Date('2026-05-24T10:00:00.000Z');
		mockUpdateReturning(buildTemplateRow({ pausedAt }));

		const res = await PATCH(
			new NextRequest(ROUTE_BASE, {
				method: 'PATCH',
				body: JSON.stringify({ paused: true }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { recurringExpense: { pausedAt: string | null } };
		expect(body.recurringExpense.pausedAt).toBe(pausedAt.toISOString());
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'recurring.paused',
				summary: 'Ava hat das Abo Netflix pausiert.',
			}),
		);
	});

	it('resumes a paused recurring template', async () => {
		const { PATCH } = await import('./route');
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[buildTemplateRow({ pausedAt: new Date('2026-05-20T00:00:00.000Z') })],
			[{ id: MEMBER_ID }],
		);
		mockUpdateReturning(buildTemplateRow({ pausedAt: null }));

		const res = await PATCH(
			new NextRequest(ROUTE_BASE, {
				method: 'PATCH',
				body: JSON.stringify({ paused: false }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }) },
		);

		expect(res.status).toBe(200);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'recurring.resumed' }),
		);
	});

	it('forbids non-owner non-admin members from patching a recurring template', async () => {
		const { PATCH } = await import('./route');
		const otherMemberId = '11111111-1111-1111-1111-111111111111';
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: otherMemberId, name: 'Ben', verified: false },
		});
		mockSelectResponses([{ id: 'wg-1' }], [buildTemplateRow({ createdByMemberId: MEMBER_ID })]);

		const res = await PATCH(
			new NextRequest(ROUTE_BASE, {
				method: 'PATCH',
				body: JSON.stringify({ description: 'Netflix neu' }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(adminMock.isVerifiedWgAdmin).toHaveBeenCalledWith('wg-1', otherMemberId, false);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-390: rate-limits recurring item PATCH before updating data', async () => {
		const { PATCH } = await import('./route');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		mockSelectResponses([{ id: 'wg-1' }], [buildTemplateRow()], [{ id: MEMBER_ID }]);
		mockUpdateReturning(buildTemplateRow({ description: 'Netflix neu' }));

		const res = await PATCH(
			new NextRequest(ROUTE_BASE, {
				method: 'PATCH',
				body: JSON.stringify({ description: 'Netflix neu' }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }) },
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`recurring-expense:wg-1:${MEMBER_ID}`,
		);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('allows admins to patch a recurring template they do not own', async () => {
		const { PATCH } = await import('./route');
		const adminMemberId = '11111111-1111-1111-1111-111111111111';
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: adminMemberId, name: 'Admin', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(true);
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[buildTemplateRow({ createdByMemberId: MEMBER_ID })],
			[{ id: MEMBER_ID }],
		);
		mockUpdateReturning(buildTemplateRow({ description: 'Netflix neu' }));

		const res = await PATCH(
			new NextRequest(ROUTE_BASE, {
				method: 'PATCH',
				body: JSON.stringify({ description: 'Netflix neu' }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }) },
		);

		expect(res.status).toBe(200);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'recurring.updated' }),
		);
	});

	it('rejects duplicate split debtors before updating a recurring template', async () => {
		const { PATCH } = await import('./route');
		const duplicateSplits = [
			{ debtorMemberId: MEMBER_ID, amountCents: 900 },
			{ debtorMemberId: MEMBER_ID, amountCents: 899 },
		];
		mockSelectResponses([{ id: 'wg-1' }], [buildTemplateRow()]);

		const res = await PATCH(
			new NextRequest(ROUTE_BASE, {
				method: 'PATCH',
				body: JSON.stringify({ splits: duplicateSplits }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'splits_duplicate_debtor' });
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('rejects empty PATCH bodies', async () => {
		const { PATCH } = await import('./route');
		const res = await PATCH(new NextRequest(ROUTE_BASE, { method: 'PATCH', body: '{}' }), {
			params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }),
		});
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'invalid_body' });
	});

	it('deletes a recurring template via the item route', async () => {
		const { DELETE } = await import('./route');
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					id: RECURRING_ID,
					createdByMemberId: MEMBER_ID,
					description: 'Netflix',
					amountCents: 1799,
					intervalMonths: 1,
					nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
				},
			],
		);
		routeDb.delete.mockReturnValue({
			where: () => ({ returning: async () => [{ id: RECURRING_ID }] }),
		});

		const res = await DELETE(new NextRequest(ROUTE_BASE, { method: 'DELETE' }), {
			params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: true });
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'recurring.deleted' }),
		);
	});

	it('RED BUG-391: rate-limits recurring item DELETE before deleting data', async () => {
		const { DELETE } = await import('./route');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					id: RECURRING_ID,
					createdByMemberId: MEMBER_ID,
					description: 'Netflix',
					amountCents: 1799,
					intervalMonths: 1,
					nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
				},
			],
		);
		routeDb.delete.mockReturnValue({
			where: () => ({ returning: async () => [{ id: RECURRING_ID }] }),
		});

		const res = await DELETE(new NextRequest(ROUTE_BASE, { method: 'DELETE' }), {
			params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }),
		});

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`recurring-expense:wg-1:${MEMBER_ID}`,
		);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('forbids non-owner non-admin members from deleting a recurring template', async () => {
		const { DELETE } = await import('./route');
		const otherMemberId = '11111111-1111-1111-1111-111111111111';
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: otherMemberId, name: 'Ben', verified: false },
		});
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					id: RECURRING_ID,
					createdByMemberId: MEMBER_ID,
					description: 'Netflix',
					amountCents: 1799,
					intervalMonths: 1,
					nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
				},
			],
		);

		const res = await DELETE(new NextRequest(ROUTE_BASE, { method: 'DELETE' }), {
			params: Promise.resolve({ code: SHARE_CODE, id: RECURRING_ID }),
		});

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(adminMock.isVerifiedWgAdmin).toHaveBeenCalledWith('wg-1', otherMemberId, false);
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
