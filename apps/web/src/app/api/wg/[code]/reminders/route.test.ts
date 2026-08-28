import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEBTOR_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76971';
const CREDITOR_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76972';
const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const REMINDER_ID = '6e6e6e6e-1111-2222-3333-444455556666';

const adminMock = vi.hoisted(() => ({ isVerifiedWgAdmin: vi.fn() }));
const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	reminderSendLimiter: 'reminderSendLimiter-stub',
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		reminderSendLimiter: rateLimitMock.reminderSendLimiter,
	};
});

vi.mock('@/lib/wg/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

vi.mock('@/lib/db/transaction', async () => {
	const { TransactionAbort } = await import('@/lib/db/transaction-abort');
	return {
		TransactionAbort,
		// Run the callback against the same mocked db — the tests exercise
		// cooldown logic, not transaction semantics.
		withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			const { db } = await import('@/lib/db');
			return fn({ ...db, execute: vi.fn().mockResolvedValue(undefined) });
		},
	};
});

// We build a Promise that exposes drizzle-style chain methods (from/where/orderBy/limit)
// so the route can do either `await db.select().from(...).where(...)` (terminal where)
// or `await db.select().from(...).where(...).orderBy(...).limit(...)` (terminal limit).
// Using the underlying Promise as the chain object avoids the noThenProperty lint.
type ChainPromise = Promise<unknown[]> & {
	from: (...args: unknown[]) => ChainPromise;
	where: (...args: unknown[]) => ChainPromise;
	orderBy: (...args: unknown[]) => ChainPromise;
	limit: (...args: unknown[]) => ChainPromise;
};

function chainResult(rows: unknown[]): ChainPromise {
	const promise = Promise.resolve(rows) as ChainPromise;
	const noop = () => promise;
	promise.from = noop;
	promise.where = noop;
	promise.orderBy = noop;
	promise.limit = noop;
	return promise;
}

// The route resolves the WG via `resolveWg(code)`, which now runs
// `db.select(...).from(wgs).where(...).limit(1)` instead of the relational
// `db.query.wgs.findFirst`. That select is therefore the first chain consumed,
// so we transparently prepend the WG row as stage 0; callers keep passing only
// their domain stages (members, expenses, splits, reminders).
const WG_ROW = { id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' };

function buildSelectMock(domainStages: ReadonlyArray<unknown[]>): void {
	const stages: ReadonlyArray<unknown[]> = [[WG_ROW], ...domainStages];
	let call = 0;
	routeDb.select.mockImplementation(() => {
		const rows = stages[call] ?? [];
		call += 1;
		return chainResult(rows);
	});
}

function buildInsertMock(returnedRows: unknown[]): void {
	routeDb.insert.mockImplementation(() => ({
		values: vi.fn(() => ({
			returning: vi.fn().mockResolvedValue(returnedRows),
		})),
	}));
}

function postRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
	return new NextRequest('https://mana.test/api/wg/MTE8PZAT/reminders', {
		method: 'POST',
		headers: { 'x-member-id': CALLER_ID, ...headers },
		body: JSON.stringify(body),
	});
}

function setupHappyPath(): {
	memberRows: Array<{ id: string; name: string; notifyReminders: boolean }>;
	expenseRows: Array<{ id: string; paidByMemberId: string; occurredAt: Date }>;
	splitRows: Array<{
		expenseId: string;
		debtorMemberId: string;
		amountCents: number;
		settledAt: Date | null;
	}>;
	recentReminders: unknown[];
} {
	const memberRows = [
		{ id: DEBTOR_ID, name: 'Ben', notifyReminders: true },
		{ id: CREDITOR_ID, name: 'Alice', notifyReminders: true },
	];
	const expenseRows = [
		{ id: 'expense-1', paidByMemberId: CREDITOR_ID, occurredAt: new Date('2026-05-01T00:00:00Z') },
	];
	const splitRows = [
		{
			expenseId: 'expense-1',
			debtorMemberId: DEBTOR_ID,
			amountCents: 2340,
			settledAt: null,
		},
	];
	const recentReminders: unknown[] = [];
	buildSelectMock([memberRows, expenseRows, splitRows, recentReminders]);
	buildInsertMock([
		{
			id: REMINDER_ID,
			wgId: 'wg-1',
			debtorMemberId: DEBTOR_ID,
			creditorMemberId: CREDITOR_ID,
			amountCents: 2340,
			channel: 'push',
			sentAt: new Date(),
		},
	]);
	return { memberRows, expenseRows, splitRows, recentReminders };
}

describe('reminders route — POST', () => {
	beforeEach(() => {
		resetRouteHarness();
		routeDb.query.wgs.findFirst.mockResolvedValue({
			id: 'wg-1',
			name: 'Küche 4',
			shareCode: 'MTE8PZAT',
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: CREDITOR_ID, name: 'Alice', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(false);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		routeMocks.dispatchNotification.mockResolvedValue(undefined);
	});

	it('sends a reminder, dispatches notification and audits when everything is valid', async () => {
		const { POST } = await import('./route');
		setupHappyPath();

		const res = await POST(
			postRequest({ debtorMemberId: DEBTOR_ID, creditorMemberId: CREDITOR_ID }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		const json = (await res.json()) as { reminder: { id: string } };
		expect(json.reminder.id).toBe(REMINDER_ID);
		expect(routeMocks.dispatchNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'expense.reminder',
				targetMemberIds: [DEBTOR_ID],
			}),
		);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'expense.reminder.sent' }),
		);
	});

	it('rejects payloads where debtor and creditor are the same member', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			postRequest({ debtorMemberId: DEBTOR_ID, creditorMemberId: DEBTOR_ID }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'same_member' });
	});

	it('returns 409 no_open_debt when the pair has nothing open', async () => {
		const { POST } = await import('./route');
		const memberRows = [
			{ id: DEBTOR_ID, name: 'Ben', notifyReminders: true },
			{ id: CREDITOR_ID, name: 'Alice', notifyReminders: true },
		];
		buildSelectMock([memberRows, [], [], []]);

		const res = await POST(
			postRequest({ debtorMemberId: DEBTOR_ID, creditorMemberId: CREDITOR_ID }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toEqual({ error: 'no_open_debt', code: 'no_open_debt' });
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});

	it('returns 429 when the 48h cooldown for the pair is still active', async () => {
		const { POST } = await import('./route');
		const memberRows = [
			{ id: DEBTOR_ID, name: 'Ben', notifyReminders: true },
			{ id: CREDITOR_ID, name: 'Alice', notifyReminders: true },
		];
		const expenseRows = [
			{
				id: 'expense-1',
				paidByMemberId: CREDITOR_ID,
				occurredAt: new Date('2026-05-01T00:00:00Z'),
			},
		];
		const splitRows = [
			{ expenseId: 'expense-1', debtorMemberId: DEBTOR_ID, amountCents: 2340, settledAt: null },
		];
		const recent = [
			{
				debtorMemberId: DEBTOR_ID,
				creditorMemberId: CREDITOR_ID,
				sentAt: new Date(Date.now() - 60 * 60 * 1000),
			},
		];
		buildSelectMock([memberRows, expenseRows, splitRows, recent]);

		const res = await POST(
			postRequest({ debtorMemberId: DEBTOR_ID, creditorMemberId: CREDITOR_ID }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		await expect(res.json()).resolves.toEqual({
			error: 'reminder_cooldown',
			code: 'reminder_cooldown',
		});
	});

	it('returns 403 when the debtor opted out of reminders', async () => {
		const { POST } = await import('./route');
		const memberRows = [
			{ id: DEBTOR_ID, name: 'Ben', notifyReminders: false },
			{ id: CREDITOR_ID, name: 'Alice', notifyReminders: true },
		];
		buildSelectMock([memberRows]);

		const res = await POST(
			postRequest({ debtorMemberId: DEBTOR_ID, creditorMemberId: CREDITOR_ID }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({
			error: 'debtor_opted_out',
			code: 'debtor_opted_out',
		});
	});

	it('rejects calls from non-members via requireMember', async () => {
		const { POST } = await import('./route');
		const failResponse = new Response(JSON.stringify({ error: 'not_a_member' }), {
			status: 401,
			headers: { 'content-type': 'application/json' },
		}) as unknown as Response;
		// resolveWg must succeed (stage 0 = WG row) before requireMember is reached.
		buildSelectMock([]);
		routeMocks.requireMember.mockResolvedValue({ ok: false, response: failResponse });

		const res = await POST(
			postRequest({ debtorMemberId: DEBTOR_ID, creditorMemberId: CREDITOR_ID }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({ error: 'not_a_member' });
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});

	it('forbids non-admin members from sending reminders for another creditor', async () => {
		const { POST } = await import('./route');
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: CALLER_ID, name: 'Mina', verified: true },
		});
		buildSelectMock([]);

		const res = await POST(
			postRequest({ debtorMemberId: DEBTOR_ID, creditorMemberId: CREDITOR_ID }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_creditor', code: 'not_creditor' });
		expect(adminMock.isVerifiedWgAdmin).toHaveBeenCalledWith('wg-1', CALLER_ID, true);
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});

	it('allows admins to send reminders for another creditor', async () => {
		const { POST } = await import('./route');
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: CALLER_ID, name: 'Mina', verified: true },
		});
		adminMock.isVerifiedWgAdmin.mockResolvedValue(true);
		setupHappyPath();

		const res = await POST(
			postRequest({ debtorMemberId: DEBTOR_ID, creditorMemberId: CREDITOR_ID }),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(routeDb.insert).toHaveBeenCalled();
	});

	it('returns 400 member_ids_invalid for malformed UUIDs', async () => {
		const { POST } = await import('./route');
		const res = await POST(postRequest({ debtorMemberId: 'nope', creditorMemberId: 'also-no' }), {
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		});
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'member_ids_invalid' });
	});
});
