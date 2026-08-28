import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const idempotencyMock = vi.hoisted(() => ({
	claimIdempotencySlot: vi.fn(),
	readIdempotencyKey: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'wg-write-limiter' },
}));

vi.mock('@/core/idempotency', () => ({
	claimIdempotencySlot: (...args: unknown[]) => idempotencyMock.claimIdempotencySlot(...args),
	readIdempotencyKey: (...args: unknown[]) => idempotencyMock.readIdempotencyKey(...args),
}));

// Stubbed rather than left to fail open, because this suite asserts the 429.
vi.mock('@/core/rate-limit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/core/rate-limit')>()),
	checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
	wgWriteLimiter: rateLimitMock.wgWriteLimiter,
}));

const SHARE_CODE = 'MTE8PZAT';
const WG_ID = 'wg-1';
const FROM_MEMBER = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const TO_MEMBER = '989ac820-58b7-431f-9c65-28721264f333';
const OTHER_MEMBER = '11111111-1111-1111-1111-111111111111';
const EXPENSE_ID = '492a85d5-3232-4faf-a2dc-552165aa4dec';
const SPLIT_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VALID_IDEM_KEY = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

interface MockShape {
	wgRows?: Array<{ id: string }>;
	members?: Array<{ id: string; name: string; color: string | null }>;
	expenseRows?: Array<{ id: string; paidByMemberId: string }>;
	splitRows?: Array<{
		id: string;
		expenseId: string;
		debtorMemberId: string;
		amountCents: number;
		settledAt: string | null;
	}>;
	updateReturning?: Array<{ id: string }>;
}

function wireSelectAndUpdate(shape: MockShape): { updateReturning: ReturnType<typeof vi.fn> } {
	const wgRows = shape.wgRows ?? [{ id: WG_ID }];
	const members = shape.members ?? [
		{ id: FROM_MEMBER, name: 'Mina', color: null },
		{ id: TO_MEMBER, name: 'Tom', color: null },
	];
	const expenseRows = shape.expenseRows ?? [{ id: EXPENSE_ID, paidByMemberId: TO_MEMBER }];
	const splitRows = shape.splitRows ?? [
		{
			id: SPLIT_ID_1,
			expenseId: EXPENSE_ID,
			debtorMemberId: FROM_MEMBER,
			amountCents: 1000,
			settledAt: null,
		},
	];
	const updateReturningRows = shape.updateReturning ?? [{ id: SPLIT_ID_1 }];

	let selectCall = 0;
	routeDb.select.mockImplementation(() => {
		selectCall += 1;
		const callIdx = selectCall;
		return {
			from: vi.fn(() => ({
				where: vi.fn((..._args: unknown[]) => {
					if (callIdx === 1) {
						return { limit: vi.fn().mockResolvedValue(wgRows) };
					}
					if (callIdx === 2) {
						return Promise.resolve(members);
					}
					if (callIdx === 3) {
						return Promise.resolve(expenseRows);
					}
					return Promise.resolve(splitRows);
				}),
			})),
		};
	});

	const updateReturning = vi.fn().mockResolvedValue(updateReturningRows);
	routeDb.update.mockReturnValue({
		set: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: updateReturning,
			})),
		})),
	});

	return { updateReturning };
}

function makeRequest(headers: Record<string, string> = {}): NextRequest {
	return new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/expenses/settle-batch`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ fromMemberId: FROM_MEMBER, toMemberId: TO_MEMBER }),
	});
}

describe('expenses settle-batch route', () => {
	beforeEach(() => {
		resetRouteHarness();
		idempotencyMock.readIdempotencyKey.mockReturnValue(null);
		idempotencyMock.claimIdempotencySlot.mockResolvedValue(true);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
	});

	it('settles open splits and records an audit event', async () => {
		const { POST } = await import('./route');
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: FROM_MEMBER, name: 'Mina', verified: true },
		});
		wireSelectAndUpdate({});

		const res = await POST(makeRequest(), {
			params: Promise.resolve({ code: SHARE_CODE }),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			settled: 1,
			settledIds: [SPLIT_ID_1],
			settledCents: 1000,
			remainingCents: 0,
			creditor: TO_MEMBER,
			debtor: FROM_MEMBER,
		});
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'expense.debt.settled' }),
		);
	});

	it('forbids non-party callers', async () => {
		const { POST } = await import('./route');
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: OTHER_MEMBER, name: 'Eve', verified: true },
		});
		wireSelectAndUpdate({});

		const res = await POST(makeRequest(), {
			params: Promise.resolve({ code: SHARE_CODE }),
		});

		expect(res.status).toBe(403);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('skips audit event when the idempotency key is already seen', async () => {
		const { POST } = await import('./route');
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: FROM_MEMBER, name: 'Mina', verified: true },
		});
		const { updateReturning } = wireSelectAndUpdate({});
		idempotencyMock.readIdempotencyKey.mockReturnValue(VALID_IDEM_KEY);
		idempotencyMock.claimIdempotencySlot.mockResolvedValue(false);

		const res = await POST(makeRequest({ 'Idempotency-Key': VALID_IDEM_KEY }), {
			params: Promise.resolve({ code: SHARE_CODE }),
		});

		expect(res.status).toBe(200);
		expect(updateReturning).toHaveBeenCalledTimes(1);
		expect(idempotencyMock.claimIdempotencySlot).toHaveBeenCalledWith(
			`settle-batch:${WG_ID}:${FROM_MEMBER}`,
			VALID_IDEM_KEY,
		);
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-004: settles only the simplified net debt instead of all direct gross splits', async () => {
		const { POST } = await import('./route');
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: FROM_MEMBER, name: 'Mina', verified: true },
		});
		wireSelectAndUpdate({
			expenseRows: [
				{ id: EXPENSE_ID, paidByMemberId: TO_MEMBER },
				{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', paidByMemberId: TO_MEMBER },
				{ id: 'cccccccc-1111-4111-8111-cccccccccccc', paidByMemberId: FROM_MEMBER },
			],
			splitRows: [
				{
					id: SPLIT_ID_1,
					expenseId: EXPENSE_ID,
					debtorMemberId: FROM_MEMBER,
					amountCents: 1000,
					settledAt: null,
				},
				{
					id: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
					expenseId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
					debtorMemberId: FROM_MEMBER,
					amountCents: 1000,
					settledAt: null,
				},
				{
					id: 'cccccccc-1111-4111-8111-cccccccccccc',
					expenseId: 'cccccccc-1111-4111-8111-cccccccccccc',
					debtorMemberId: TO_MEMBER,
					amountCents: 1000,
					settledAt: null,
				},
			],
			updateReturning: [{ id: SPLIT_ID_1 }, { id: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb' }],
		});

		const res = await POST(makeRequest(), {
			params: Promise.resolve({ code: SHARE_CODE }),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			settled: 1,
			settledIds: [SPLIT_ID_1],
			settledCents: 1000,
			remainingCents: 0,
			creditor: TO_MEMBER,
			debtor: FROM_MEMBER,
		});
	});

	it('C1: reports no_direct_splits when the net debt is purely transitive', async () => {
		const { POST } = await import('./route');
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: FROM_MEMBER, name: 'Mina', verified: true },
		});
		// Mina owes Eve, Eve owes Tom. Simplified: Mina -> Tom. But there is no
		// direct split from Mina to Tom, so nothing can be marked settled.
		wireSelectAndUpdate({
			members: [
				{ id: FROM_MEMBER, name: 'Mina', color: null },
				{ id: TO_MEMBER, name: 'Tom', color: null },
				{ id: OTHER_MEMBER, name: 'Eve', color: null },
			],
			expenseRows: [
				{ id: EXPENSE_ID, paidByMemberId: OTHER_MEMBER },
				{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', paidByMemberId: TO_MEMBER },
			],
			splitRows: [
				{
					id: SPLIT_ID_1,
					expenseId: EXPENSE_ID,
					debtorMemberId: FROM_MEMBER,
					amountCents: 1000,
					settledAt: null,
				},
				{
					id: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
					expenseId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
					debtorMemberId: OTHER_MEMBER,
					amountCents: 1000,
					settledAt: null,
				},
			],
		});

		const res = await POST(makeRequest(), {
			params: Promise.resolve({ code: SHARE_CODE }),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			settled: 0,
			settledIds: [],
			settledCents: 0,
			remainingCents: 1000,
			reason: 'no_direct_splits',
			creditor: TO_MEMBER,
			debtor: FROM_MEMBER,
		});
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('C1: reports remainingCents when direct splits cover the net debt only partially', async () => {
		const { POST } = await import('./route');
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: FROM_MEMBER, name: 'Mina', verified: true },
		});
		// Net debt Mina -> Tom is 1500, but only 1000 exists as a direct split;
		// the remaining 500 flows through Eve.
		wireSelectAndUpdate({
			members: [
				{ id: FROM_MEMBER, name: 'Mina', color: null },
				{ id: TO_MEMBER, name: 'Tom', color: null },
				{ id: OTHER_MEMBER, name: 'Eve', color: null },
			],
			expenseRows: [
				{ id: EXPENSE_ID, paidByMemberId: TO_MEMBER },
				{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', paidByMemberId: OTHER_MEMBER },
				{ id: 'cccccccc-1111-4111-8111-cccccccccccc', paidByMemberId: TO_MEMBER },
			],
			splitRows: [
				{
					id: SPLIT_ID_1,
					expenseId: EXPENSE_ID,
					debtorMemberId: FROM_MEMBER,
					amountCents: 1000,
					settledAt: null,
				},
				{
					id: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
					expenseId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
					debtorMemberId: FROM_MEMBER,
					amountCents: 500,
					settledAt: null,
				},
				{
					id: 'dddddddd-1111-4111-8111-dddddddddddd',
					expenseId: 'cccccccc-1111-4111-8111-cccccccccccc',
					debtorMemberId: OTHER_MEMBER,
					amountCents: 500,
					settledAt: null,
				},
			],
			updateReturning: [{ id: SPLIT_ID_1 }],
		});

		const res = await POST(makeRequest(), {
			params: Promise.resolve({ code: SHARE_CODE }),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			settled: 1,
			settledIds: [SPLIT_ID_1],
			settledCents: 1000,
			remainingCents: 500,
			creditor: TO_MEMBER,
			debtor: FROM_MEMBER,
		});
	});

	it('RED BUG-552: rate-limits settle-batch before updating splits', async () => {
		const { POST } = await import('./route');
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: FROM_MEMBER, name: 'Mina', verified: true },
		});
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 123,
		});
		wireSelectAndUpdate({});

		const res = await POST(makeRequest(), {
			params: Promise.resolve({ code: SHARE_CODE }),
		});

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			`settle-batch:${WG_ID}:${FROM_MEMBER}`,
		);
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
