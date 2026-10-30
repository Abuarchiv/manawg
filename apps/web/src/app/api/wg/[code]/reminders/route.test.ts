import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const wgId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const creditorId = '44444444-4444-4444-8444-444444444444';
const debtorId = '55555555-5555-4555-8555-555555555555';
const adminId = '66666666-6666-4666-8666-666666666666';

let callerId = actorId;
let activeAdminId = adminId;
let inserted: Record<string, unknown>[] = [];
let dispatched = 0;
let audited = 0;

const members = [creditorId, debtorId].map((id) => ({
	id,
	name: id === creditorId ? 'Anna' : 'Ben',
	notifyReminders: true,
	pushOptIn: true,
	authUserId: null,
}));
const openExpenses = [
	{
		paidByMemberId: creditorId,
		currency: 'EUR',
		occurredAt: '2026-09-01T10:00:00.000Z',
		splits: [{ debtorMemberId: debtorId, amountCents: 1000, settledAt: null }],
	},
];

// Reads answer the member rows; the admin lookup (`.limit`) answers the active admin.
const db = {
	select: () => ({
		from: () => ({
			where: () =>
				Object.assign(Promise.resolve(members), {
					limit: async () => [{ id: activeAdminId }],
				}),
		}),
	}),
};
const tx = {
	execute: async () => undefined,
	select: () => {
		const builder = Promise.resolve([]) as unknown as Record<string, unknown>;
		for (const method of ['from', 'where', 'orderBy', 'limit']) builder[method] = () => builder;
		return builder;
	},
	insert: () => ({
		values: (values: Record<string, unknown>) => {
			inserted.push(values);
			return { returning: async () => [{ id: 'reminder-1', oldestDebtAgeDays: 1, ...values }] };
		},
	}),
};

mock.module('server-only', { namedExports: {} });
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => conditions,
		desc: (column: unknown) => column,
		eq: (column: unknown, value: unknown) => [column, value],
		gte: (column: unknown, value: unknown) => [column, value],
		inArray: (column: unknown, values: unknown) => [column, values],
		isNull: (column: unknown) => column,
		sql: (parts: unknown, ...values: unknown[]) => ({ parts, values }),
	},
});
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			audited += 1;
		},
	},
});
mock.module('@/core/db', {
	namedExports: {
		db,
		expenseReminders: {},
		wgMembers: { id: 'wg_members.id', role: 'wg_members.role' },
	},
});
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		responseCodec: () => ({}),
		// Runs the real prepare and write callbacks against the fake transaction.
		withIdempotentWrite: async (
			opts: { prepare: () => Promise<{ stop: Response } | { input: unknown }> },
			write: (tx: unknown, input: unknown) => Promise<Record<string, unknown>>,
		) => {
			const prepared = await opts.prepare();
			if ('stop' in prepared) return { kind: 'stopped', response: prepared.stop };
			return { kind: 'written', ...(await write(tx, (prepared as { input: unknown }).input)) };
		},
	},
});
mock.module('@/core/guards/api-auth', {
	namedExports: {
		UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
			member: { memberId: callerId, name: 'Alex' },
		}),
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: { readIdempotencyKey: () => null, setReplayWarning: async () => true },
});
mock.module('@/core/infra/after-response', { namedExports: { afterResponse: () => undefined } });
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async () => {
			dispatched += 1;
			return { sent: 1, warning: null };
		},
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), reminderSendLimiter: {} },
});
mock.module('@/features/expenses/server/expense-ledger', {
	namedExports: { loadExpensesWithSplits: async () => openExpenses },
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: { loadCompletedExpensePayments: async () => [] },
});
mock.module('@/features/expenses/server/reminder-mail', {
	namedExports: { sendReminderMail: async () => undefined },
});

const { POST } = await import('./route');

function setup() {
	callerId = actorId;
	activeAdminId = adminId;
	inserted = [];
	dispatched = 0;
	audited = 0;
}

function post(debtorMemberId = debtorId, creditorMemberId = creditorId) {
	return POST(
		new Request('https://example.invalid/x', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ debtorMemberId, creditorMemberId }),
		}) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
	);
}

test('a member who is neither creditor nor admin gets 403 and nothing is sent', async () => {
	setup();
	const response = await post();
	assert.equal(response.status, 403);
	assert.equal((await response.json()).error, 'not_creditor');
	assert.equal(inserted.length, 0);
	assert.equal(dispatched, 0);
	assert.equal(audited, 0);
});

test('the creditor sends a reminder', async () => {
	setup();
	callerId = creditorId;
	const response = await post();
	assert.equal(response.status, 200);
	assert.equal(inserted.length, 1);
	assert.equal(inserted[0]?.sentByMemberId, creditorId);
	assert.equal(dispatched, 1);
});

test('an admin sends a reminder for a debt owed to someone else', async () => {
	setup();
	activeAdminId = actorId;
	const response = await post();
	assert.equal(response.status, 200);
	assert.equal(inserted.length, 1);
	assert.equal(inserted[0]?.sentByMemberId, actorId);
	assert.equal(dispatched, 1);
});
