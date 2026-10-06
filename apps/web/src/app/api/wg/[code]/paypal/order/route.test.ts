import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../../../tests/support/db-mock';
import { mockDrizzle, rowMatches } from '../../../../../../../tests/support/drizzle-mock';
import {
	importUnmocked,
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../tests/support/route-harness';

// The route and the real debt math run against one in-memory payment row; PayPal itself is
// scripted per test.

const wgId = '1bc67a5a-5c08-4c0d-8eaf-520def98021a';
const fromMemberId = '2bc67a5a-5c08-4c0d-8eaf-520def98021a';
const toMemberId = '3bc67a5a-5c08-4c0d-8eaf-520def98021a';

type PayPal = typeof import('@/core/infra/paypal');
const realPayPal = (await importUnmocked('core/infra/paypal.ts')) as PayPal;

const wgMembers = {
	id: 'id',
	wgId: 'wgId',
	name: 'name',
	color: 'color',
	paypalMerchantId: 'paypalMerchantId',
};
const expensePayments = {
	id: 'id',
	wgId: 'wgId',
	fromMemberId: 'fromMemberId',
	toMemberId: 'toMemberId',
	provider: 'provider',
	providerOrderId: 'providerOrderId',
	amountCents: 'amountCents',
	currency: 'currency',
	status: 'status',
	expiresAt: 'expiresAt',
	payeeMerchantId: 'payeeMerchantId',
};
const members = [
	{ id: fromMemberId, wgId, name: 'Payer', color: 'blue', paypalMerchantId: null },
	{ id: toMemberId, wgId, name: 'Payee', color: 'green', paypalMerchantId: '2B23456789ABC' },
];
// The payee paid 10 € that the payer owes in full: a direct debt of 1000 cents.
const openExpenses = [
	{
		paidByMemberId: toMemberId,
		currency: 'EUR',
		occurredAt: '2026-09-01T10:00:00.000Z',
		splits: [{ debtorMemberId: fromMemberId, amountCents: 1_000, settledAt: null }],
	},
];

type Payment = Record<string, unknown> & { id: string; status: string; providerOrderId: string };
interface OrderInput {
	requestId: string;
}

const state = {
	payment: null as Payment | null,
	failedUpdates: 0,
	orderRequests: [] as OrderInput[],
	isPayPalMerchantReady: async (): Promise<boolean> => true,
	createPayPalOrder: async (_input: OrderInput): Promise<{ id: string }> => ({ id: 'order-id' }),
};

function harness(scripts: {
	isPayPalMerchantReady: () => Promise<boolean>;
	createPayPalOrder: (input: OrderInput) => Promise<{ id: string }>;
}) {
	state.payment = null;
	state.failedUpdates = 0;
	state.orderRequests = [];
	state.isPayPalMerchantReady = scripts.isPayPalMerchantReady;
	state.createPayPalOrder = scripts.createPayPalOrder;
	return state;
}

function select() {
	let rows: Record<string, unknown>[] = [];
	const query = Object.assign(
		Promise.resolve().then(() => rows),
		{
			from(table: unknown) {
				rows =
					table === wgMembers
						? members
						: table === expensePayments && state.payment
							? [{ ...state.payment, orderId: state.payment.providerOrderId }]
							: [];
				return query;
			},
			where(condition: unknown) {
				rows = rows.filter((row) => rowMatches(row, condition));
				return query;
			},
			limit(count: number) {
				return Promise.resolve(rows.slice(0, count));
			},
		},
	);
	return query;
}

const tx = {
	select,
	insert: () => ({
		values: (values: Record<string, unknown>) => ({
			onConflictDoNothing: () => ({
				returning: async () => {
					if (state.payment) return [];
					state.payment = {
						...values,
						id: 'payment-id',
						status: 'created',
						providerOrderId: String(values.providerOrderId),
					};
					return [{ id: state.payment.id }];
				},
			}),
		}),
	}),
	update: () => ({
		set: (updates: Partial<Payment>) => ({
			where: (condition: unknown) => {
				const payment = state.payment;
				const matched = Boolean(payment && rowMatches(payment, condition));
				if (payment && matched) {
					Object.assign(payment, updates);
					if (updates.status === 'failed') state.failedUpdates += 1;
				}
				return Object.assign(Promise.resolve(), {
					returning: async () => (payment && matched ? [{ id: payment.id }] : []),
				});
			},
		}),
	}),
};

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: wgId }, member: { memberId: fromMemberId, name: 'Payer' } });
mockDb({ expensePayments, wgMembers });
mock.module('@/core/infra/paypal', {
	namedExports: {
		isPayPalConfigured: () => true,
		isTerminalPayPalOrderCreationError: realPayPal.isTerminalPayPalOrderCreationError,
		createPayPalOrder: async (input: OrderInput) => {
			state.orderRequests.push(input);
			return state.createPayPalOrder(input);
		},
	},
});
mock.module('@/core/infra/paypal-onboarding', {
	namedExports: { isPayPalMerchantReady: () => state.isPayPalMerchantReady() },
});
mock.module('@/features/expenses/expense-payments', {
	namedExports: {
		PAYPAL_ORDER_TTL_MS: 60_000,
		loadCompletedExpensePayments: async () => [],
		withExpensePaymentLock: async (_id: string, operation: (handle: typeof tx) => unknown) =>
			operation(tx),
	},
});
mock.module('@/features/expenses/open-expenses', {
	namedExports: { loadOpenExpenses: async () => openExpenses },
});

const { POST } = await import('./route');

const post = () =>
	POST(
		request('/api/wg/MTE8PZAT/paypal/order', {
			method: 'POST',
			body: { fromMemberId, toMemberId, currency: 'EUR' },
		}),
		routeCtx(),
	);

test('new PayPal order is refused when the recipient has lost provider readiness', async () => {
	const current = harness({
		isPayPalMerchantReady: async () => false,
		createPayPalOrder: async () => ({ id: 'order-id' }),
	});
	const response = await post();
	assert.equal(response.status, 409);
	assert.equal((await response.json()).error, 'paypal_onboarding_pending');
	assert.equal(current.orderRequests.length, 0);
	assert.equal(current.failedUpdates, 1);
	assert.equal(current.payment?.status, 'failed');
});

test('late readiness denial cannot release an already advanced reservation', async () => {
	for (const finalState of [
		{ status: 'created', providerOrderId: 'paypal-order-race' },
		{ status: 'capturing', providerOrderId: 'paypal-order-race' },
		{ status: 'completed', providerOrderId: 'paypal-order-race' },
	]) {
		let releaseReadiness: (ready: boolean) => void = () => undefined;
		let notifyReadinessStarted: () => void = () => undefined;
		const readinessStarted = new Promise<void>((resolve) => {
			notifyReadinessStarted = resolve;
		});
		const readinessGate = new Promise<boolean>((resolve) => {
			releaseReadiness = resolve;
		});
		const current = harness({
			isPayPalMerchantReady: async () => {
				notifyReadinessStarted();
				return readinessGate;
			},
			createPayPalOrder: async () => {
				throw new Error('order creation must not run after readiness was denied');
			},
		});

		const pendingRequest = post();
		await readinessStarted;
		const payment = current.payment as Payment;
		const paymentId = payment.id;
		assert.equal(payment.status, 'created');
		assert.match(payment.providerOrderId, /^pending:/);

		// Another request may move the row while PayPal's readiness lookup waits.
		Object.assign(payment, finalState);
		releaseReadiness(false);
		const response = await pendingRequest;
		assert.equal(response.status, 409);
		assert.equal((await response.json()).error, 'paypal_onboarding_pending');
		assert.equal(current.payment?.id, paymentId);
		assert.equal(current.payment?.status, finalState.status);
		assert.equal(current.payment?.providerOrderId, finalState.providerOrderId);
		assert.equal(current.failedUpdates, 0);
		assert.equal(current.orderRequests.length, 0);
	}
});

test('readiness and provider availability failures retry the same pending payment id', async () => {
	let readinessCalls = 0;
	let createCalls = 0;
	const current = harness({
		isPayPalMerchantReady: async () => {
			readinessCalls += 1;
			if (readinessCalls === 1) throw new Error('paypal_api_503');
			return true;
		},
		createPayPalOrder: async () => {
			createCalls += 1;
			if (createCalls === 1) throw new Error('paypal_api_503');
			return { id: 'paypal-order-recovered' };
		},
	});

	const readinessFailure = await post();
	assert.equal(readinessFailure.status, 500);
	const paymentId = current.payment?.id;
	const pendingOrderId = current.payment?.providerOrderId ?? '';
	assert.match(pendingOrderId, /^pending:/);
	assert.equal(current.payment?.status, 'created');
	assert.equal(current.failedUpdates, 0);
	assert.equal(current.orderRequests.length, 0);

	const providerFailure = await post();
	assert.equal(providerFailure.status, 500);
	assert.equal(current.payment?.id, paymentId);
	assert.equal(current.payment?.providerOrderId, pendingOrderId);
	assert.equal(current.payment?.status, 'created');
	assert.equal(current.orderRequests.length, 1);
	assert.equal(current.orderRequests[0]?.requestId, paymentId);
	assert.equal(current.failedUpdates, 0);

	const recovered = await post();
	assert.equal(recovered.status, 200);
	assert.equal(current.payment?.id, paymentId);
	assert.equal(current.payment?.providerOrderId, 'paypal-order-recovered');
	assert.equal(current.orderRequests.length, 2);
	assert.deepEqual(
		current.orderRequests.map((order) => order.requestId),
		[paymentId, paymentId],
	);
	assert.equal(current.failedUpdates, 0);
});
