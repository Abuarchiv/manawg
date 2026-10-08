import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { DbTransaction } from '@/core/db/transaction';

// The database layer connects on import; the logic under test only needs table markers.
mock.module('server-only', { namedExports: {} });
mock.module('@/core/db', {
	namedExports: { expensePayments: {}, wgMembers: {}, expenseSplits: {}, expenses: {}, db: {} },
});
mock.module('@/core/db/transaction', {
	namedExports: {
		lockExpensePayments: async () => undefined,
		withTransaction: async () => undefined,
	},
});
mock.module('@/core/db/idempotent-write', { namedExports: { responseCodec: () => ({}) } });
const { manualPaymentSchema, recordCashPayment } = await import(
	'@/features/expenses/manual-payment'
);

const WG = '99999999-9999-4999-8999-999999999999';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const members = [
	{ id: A, name: 'Anna', color: null },
	{ id: B, name: 'Ben', color: null },
	{ id: C, name: 'Cem', color: null },
];

/** A transaction whose selects answer from a queue, in the order recordCashPayment asks. */
function fakeTx(datasets: unknown[][]) {
	const inserted: Array<Record<string, unknown>> = [];
	let call = 0;
	const tx = {
		select: () => {
			const rows = datasets[call++] ?? [];
			const builder = Promise.resolve(rows) as unknown as Record<string, unknown>;
			for (const method of ['from', 'where', 'innerJoin', 'limit', 'for']) {
				builder[method] = () => builder;
			}
			return builder;
		},
		insert: () => ({
			values: (values: Record<string, unknown>) => {
				inserted.push(values);
				return { returning: async () => [{ id: 'payment-1' }] };
			},
		}),
	} as unknown as DbTransaction;
	return { tx, inserted };
}

// Anna paid for Cem's share of 1000; Cem paid for Ben's share of 1000: "Ben owes Anna 1000" nets.
const chainedExpenses = [
	{ id: 'e1', paidByMemberId: A, currency: 'EUR', occurredAt: new Date('2026-09-01T10:00:00Z') },
	{ id: 'e2', paidByMemberId: C, currency: 'EUR', occurredAt: new Date('2026-09-02T10:00:00Z') },
];
const chainedSplits = [
	{ id: 's1', expenseId: 'e1', debtorMemberId: C, amountCents: 1000, settledAt: null },
	{ id: 's2', expenseId: 'e2', debtorMemberId: B, amountCents: 1000, settledAt: null },
];

function datasets(caller: unknown[], capturing: unknown[] = []) {
	return [caller, members, chainedExpenses, chainedSplits, [], capturing];
}

const input = { fromMemberId: B, toMemberId: A, currency: 'EUR' as const, expectedNetCents: 1000 };

test('a netted debt is recorded as one completed manual payment for the whole net amount', async () => {
	const { tx, inserted } = fakeTx(datasets([{ id: B }]));
	const result = await recordCashPayment(tx, WG, B, input);
	assert.equal(result.status, 200);
	assert.equal(inserted.length, 1);
	assert.deepEqual(
		{ ...inserted[0], providerOrderId: undefined, expiresAt: undefined, completedAt: undefined },
		{
			wgId: WG,
			fromMemberId: B,
			toMemberId: A,
			amountCents: 1000,
			currency: 'EUR',
			provider: 'manual',
			providerOrderId: undefined,
			payeeMerchantId: 'manual',
			status: 'completed',
			expiresAt: undefined,
			completedAt: undefined,
		},
	);
	assert.match(String(inserted[0]?.providerOrderId), /^manual:/);
});

test('a net amount that changed since the review records nothing', async () => {
	const { tx, inserted } = fakeTx(datasets([{ id: B }]));
	const result = await recordCashPayment(tx, WG, B, { ...input, expectedNetCents: 900 });
	assert.equal(result.status, 409);
	assert.equal(result.context?.kind, 'changed');
	assert.equal(inserted.length, 0);
});

test('a debt that does not exist records nothing', async () => {
	const { tx, inserted } = fakeTx(datasets([{ id: A }]));
	const result = await recordCashPayment(tx, WG, A, { ...input, fromMemberId: A, toMemberId: B });
	assert.equal(result.context?.kind, 'changed');
	assert.equal(inserted.length, 0);
});

test('a running PayPal capture blocks the payment', async () => {
	const { tx, inserted } = fakeTx(datasets([{ id: B }], [{ id: 'capturing' }]));
	const result = await recordCashPayment(tx, WG, B, input);
	assert.equal(result.context?.kind, 'blocked');
	assert.equal(inserted.length, 0);
});

test('a moved-out caller is refused', async () => {
	const { tx, inserted } = fakeTx(datasets([]));
	const result = await recordCashPayment(tx, WG, B, input);
	assert.equal(result.status, 401);
	assert.equal(result.context?.kind, 'member_deactivated');
	assert.equal(inserted.length, 0);
});

test('a member outside the WG is refused', async () => {
	const stranger = '44444444-4444-4444-8444-444444444444';
	const { tx, inserted } = fakeTx(datasets([{ id: B }]));
	const result = await recordCashPayment(tx, WG, B, { ...input, toMemberId: stranger });
	assert.equal(result.context?.kind, 'member_not_in_wg');
	assert.equal(inserted.length, 0);
});

test('the request body is strict and needs a positive whole amount', () => {
	assert.equal(manualPaymentSchema.safeParse(input).success, true);
	assert.equal(manualPaymentSchema.safeParse({ ...input, expectedNetCents: 0 }).success, false);
	assert.equal(manualPaymentSchema.safeParse({ ...input, expectedNetCents: 10.5 }).success, false);
	assert.equal(manualPaymentSchema.safeParse({ ...input, extra: true }).success, false);
	assert.equal(manualPaymentSchema.safeParse({ ...input, fromMemberId: 'x' }).success, false);
});
