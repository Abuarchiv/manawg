// PayPal capture state machine: a capture settles exactly once, stays pending while the provider
// result is ambiguous, and never settles a payment whose payee, amount or currency differs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextRequest } from 'next/server';
import {
	type ExpensePaymentInput,
	computeNetBalances,
	simplifyDebts,
} from '../src/features/expenses/debt-reduction.ts';
import { type DebtExpenseInput, computeBalances } from '../src/features/expenses/debts.ts';
import { assertMatchObject, matchesObject } from './support/match-object';
import { mockModuleWithReal } from './support/module-mocks';
import { jsonResponse } from './support/values';

const wgId = '550e8400-e29b-41d4-a716-446655440000';
const payerId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const payeeId = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const providerOrderId = 'paypal-order-1';

const expensePayments = {
	id: 'payment.id',
	wgId: 'payment.wgId',
	provider: 'payment.provider',
	providerOrderId: 'payment.providerOrderId',
	fromMemberId: 'payment.fromMemberId',
	toMemberId: 'payment.toMemberId',
	payeeMerchantId: 'payment.payeeMerchantId',
	status: 'payment.status',
	expiresAt: 'payment.expiresAt',
};
const wgMembers = {
	id: 'member.id',
	wgId: 'member.wgId',
	name: 'member.name',
	color: 'member.color',
	paypalMerchantId: 'member.paypalMerchantId',
};

type Tx = Record<string, unknown>;

/** The PayPal provider, database and payment lock of the fixture under test. */
interface Harness {
	select: (columns?: Record<string, unknown>) => unknown;
	withPaymentLock: (operation: (tx: Tx) => Promise<unknown>) => Promise<unknown>;
	openExpenses: DebtExpenseInput[];
	completedPayments: ExpensePaymentInput[];
	anotherCaptureActive: boolean;
	capturePayPalOrder: (id: string) => Promise<Record<string, unknown>>;
	getPayPalOrder: (id: string) => Promise<Record<string, unknown>>;
	createPayPalOrder: (input: Record<string, unknown>) => Promise<{ id: string }>;
}

let current: Harness | null = null;
const harness = (): Harness => {
	if (!current) throw new Error('no PayPal fixture is active');
	return current;
};

await mockModuleWithReal('drizzle-orm', {
	and: (...conditions: unknown[]) => conditions,
	eq: (column: unknown, value: unknown) => ({ column, value }),
	gt: (column: unknown, value: unknown) => ({ column, value }),
	inArray: (column: unknown, values: unknown[]) => ({ column, values }),
	lte: (column: unknown, value: unknown) => ({ column, value }),
	sql: () => ({}),
});
await mockModuleWithReal('@/core/http/api-errors', {
	badRequest: (code: string) => jsonResponse({ error: code }, 400),
	conflict: (code: string) => jsonResponse({ error: code }, 409),
	forbidden: (code: string) => jsonResponse({ error: code }, 403),
	serverError: (code: string) => jsonResponse({ error: code }, 500),
	tooMany: () => jsonResponse({ error: 'too_many' }, 429),
});
await mockModuleWithReal('@/core/infra/observability', { logApiError: () => undefined });
await mockModuleWithReal('@/core/infra/paypal-onboarding', {
	isPayPalMerchantReady: async () => true,
});
await mockModuleWithReal('@/core/infra/paypal', {
	capturePayPalOrder: (id: string) => harness().capturePayPalOrder(id),
	getPayPalOrder: (id: string) => harness().getPayPalOrder(id),
	createPayPalOrder: (input: Record<string, unknown>) => harness().createPayPalOrder(input),
	isPayPalConfigured: () => true,
});
await mockModuleWithReal('@/features/expenses/server/expense-payments', {
	PAYPAL_ORDER_TTL_MS: 10_000,
	loadCompletedExpensePayments: async () => harness().completedPayments,
	hasCapturingExpensePayment: async () => harness().anotherCaptureActive,
	withExpensePaymentLock: (_id: string, operation: (tx: Tx) => Promise<unknown>) =>
		harness().withPaymentLock(operation),
});
await mockModuleWithReal('@/features/expenses/server/open-expenses', {
	loadOpenExpenses: async () => harness().openExpenses,
});
await mockModuleWithReal('@/core/db', {
	db: { select: (columns?: Record<string, unknown>) => harness().select(columns) },
	expensePayments,
	wgMembers,
});
await mockModuleWithReal('@/core/audit', { recordAuditEvent: async () => undefined });
await mockModuleWithReal('@/core/db/account-deletion', {
	lockActiveAccountMember: async () => ({ memberId: payerId }),
});
await mockModuleWithReal('@/core/guards/require-wg-member', {
	requireWgMember: async () => ({
		ok: true,
		wg: { id: wgId },
		member: { memberId: payerId, name: 'Mina' },
		authUserId: payerId,
	}),
});
await mockModuleWithReal('@/core/guards/with-wg-route', {
	withWgRoute: (_name: string, handler: unknown) => handler,
});
await mockModuleWithReal('@/core/rate-limit', {
	checkRateLimit: async () => ({ success: true }),
	wgWriteLimiter: {},
});

// withWgRoute is the identity here, so the handler receives the context the wrapper would build.
const handlerCtx = { code: 'test' } as never;
const captureRoute = await import('../src/app/api/wg/[code]/paypal/capture/route');
const orderRoute = await import('../src/app/api/wg/[code]/paypal/order/route');

describe('paypal capture state', () => {
	type ProviderResponse = Record<string, unknown> | Error;

	function completedOrder(
		options: {
			orderStatus?: string;
			captureStatus?: string;
			amount?: string;
			currency?: string;
			merchantId?: string;
		} = {},
	): Record<string, unknown> {
		return {
			id: providerOrderId,
			status: options.orderStatus ?? 'COMPLETED',
			purchase_units: [
				{
					payee: { merchant_id: options.merchantId ?? 'merchant-1' },
					payments: {
						captures: [
							{
								status: options.captureStatus ?? 'COMPLETED',
								amount: {
									value: options.amount ?? '12.00',
									currency_code: options.currency ?? 'EUR',
								},
							},
						],
					},
				},
			],
		};
	}

	function createPayPalFixture(
		options: {
			captureResponses?: ProviderResponse[];
			orderResponses?: ProviderResponse[];
			createdOrderIds?: string[];
			createdOrderErrors?: Error[];
			initialOrderId?: string;
			initialStatus?: string;
			initialAmountCents?: number;
			expenses?: DebtExpenseInput[];
			completedPayments?: ExpensePaymentInput[];
			members?: Array<{
				id: string;
				name: string;
				color: string | null;
				paypalMerchantId: string | null;
			}>;
			anotherCaptureActive?: boolean;
		} = {},
	) {
		let payment: Record<string, unknown> = {
			id: 'payment-1',
			wgId,
			provider: 'paypal',
			providerOrderId: options.initialOrderId ?? providerOrderId,
			payeeMerchantId: 'merchant-1',
			fromMemberId: payerId,
			toMemberId: payeeId,
			amountCents: options.initialAmountCents ?? 1200,
			currency: 'EUR',
			status: options.initialStatus ?? 'created',
			expiresAt: new Date(Date.now() + 60_000),
		};
		const statusWrites: string[] = [];
		const captureOrderIds: string[] = [];
		const readOrderIds: string[] = [];
		const createdOrderInputs: Array<Record<string, unknown>> = [];
		const captureResponses = [...(options.captureResponses ?? [completedOrder()])];
		const orderResponses = [...(options.orderResponses ?? [])];
		const createdOrderIds = [...(options.createdOrderIds ?? ['paypal-order-replacement'])];
		const createdOrderErrors = [...(options.createdOrderErrors ?? [])];
		const members = (
			options.members ?? [
				{ id: payerId, name: 'Mina', color: 'blue', paypalMerchantId: null },
				{ id: payeeId, name: 'Noah', color: 'green', paypalMerchantId: 'merchant-1' },
			]
		).map((member) => ({ ...member, wgId }));
		const openExpenses = options.expenses ?? [
			{
				paidByMemberId: payeeId,
				currency: 'EUR',
				occurredAt: '2026-09-27T00:00:00.000Z',
				splits: [{ debtorMemberId: payerId, amountCents: 1_200, settledAt: null }],
			},
		];
		let paymentSequence = 0;

		function nextResponse(
			queue: ProviderResponse[],
			fallback: ProviderResponse,
		): Record<string, unknown> {
			const response = queue.shift() ?? fallback;
			if (response instanceof Error) throw response;
			return response;
		}

		function selectQuery(initialSelection?: Record<string, unknown>) {
			let selectedTable: unknown;
			let selection = initialSelection;
			let whereCondition: unknown;
			const matches = (row: Record<string, unknown>, condition: unknown): boolean => {
				if (Array.isArray(condition)) return condition.every((item) => matches(row, item));
				if (typeof condition !== 'object' || condition === null) return true;
				const filter = condition as { column?: unknown; value?: unknown; values?: unknown[] };
				if (filter.column === undefined) return true;
				const field = String(filter.column).split('.').at(-1) ?? '';
				if (Array.isArray(filter.values)) return filter.values.includes(row[field]);
				if ('value' in filter) return row[field] === filter.value;
				return true;
			};
			const project = (row: Record<string, unknown>) => {
				if (!selection) return { ...row };
				return Object.fromEntries(
					Object.entries(selection).map(([name, column]) => {
						const field = String(column).split('.').at(-1) ?? name;
						return [name, row[field]];
					}),
				);
			};
			const rows = () => {
				if (selectedTable === expensePayments) {
					const records = [payment];
					if (options.anotherCaptureActive) {
						records.push({
							...payment,
							id: 'other-payment',
							providerOrderId: 'paypal-other-order',
							fromMemberId: '00000000-0000-4000-8000-000000000009',
							status: 'capturing',
						});
					}
					return records
						.filter((row) => row.status !== 'failed' && matches(row, whereCondition))
						.map(project);
				}
				if (selectedTable === wgMembers) {
					return members.filter((row) => matches(row, whereCondition)).map(project);
				}
				return [];
			};
			const chain: Record<PropertyKey, unknown> = new Proxy(
				{},
				{
					get: (_target, key) => {
						if (key === 'then') {
							return (
								resolve: (value: unknown) => unknown,
								reject?: (reason: unknown) => unknown,
							) => Promise.resolve(rows()).then(resolve, reject);
						}
						if (key === 'limit') return async () => rows();
						if (key === 'where') {
							return (condition: unknown) => {
								whereCondition = condition;
								return chain;
							};
						}
						if (key === 'select') {
							return (columns?: Record<string, unknown>) => {
								selection = columns;
								return chain;
							};
						}
						if (key === 'from') {
							return (table: unknown) => {
								selectedTable = table;
								return chain;
							};
						}
						return () => chain;
					},
				},
			);
			return chain;
		}

		const tx = {
			select: selectQuery,
			update: () => ({
				set: (values: Record<string, unknown>) => {
					if (typeof values.status === 'string') statusWrites.push(values.status);
					Object.assign(payment, values);
					return {
						where: () => ({
							returning: async () => [{ ...payment }],
						}),
					};
				},
			}),
			insert: () => ({
				values: (values: Record<string, unknown>) => {
					const result = {
						onConflictDoNothing: () => result,
						returning: async () => {
							payment = {
								...values,
								id: `payment-replacement-${++paymentSequence}`,
								provider: 'paypal',
								status: 'created',
							};
							return [{ id: payment.id }];
						},
					};
					return result;
				},
			}),
		};
		current = {
			select: selectQuery,
			withPaymentLock: (operation) => operation(tx),
			openExpenses,
			completedPayments: options.completedPayments ?? [],
			anotherCaptureActive: options.anotherCaptureActive ?? false,
			capturePayPalOrder: async (id) => {
				captureOrderIds.push(id);
				return nextResponse(captureResponses, completedOrder());
			},
			getPayPalOrder: async (id) => {
				readOrderIds.push(id);
				return nextResponse(orderResponses, completedOrder());
			},
			createPayPalOrder: async (input) => {
				createdOrderInputs.push(input);
				const error = createdOrderErrors.shift();
				if (error) throw error;
				return { id: createdOrderIds.shift() ?? 'paypal-order-extra' };
			},
		};

		const capture = (orderId = providerOrderId) =>
			captureRoute.POST(
				new NextRequest('http://localhost/api/wg/test/paypal/capture', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ orderId }),
				}),
				handlerCtx,
			);
		const lookupOrder = (toMemberId = payeeId) => {
			if (!orderRoute.GET) throw new Error('PayPal order status lookup is missing');
			return orderRoute.GET(
				new NextRequest(`http://localhost/api/wg/test/paypal/order?toMemberId=${toMemberId}`),
				handlerCtx,
			);
		};
		const createOrder = () =>
			orderRoute.POST(
				new NextRequest('http://localhost/api/wg/test/paypal/order', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ fromMemberId: payerId, toMemberId: payeeId, currency: 'EUR' }),
				}),
				handlerCtx,
			);

		return {
			capture,
			lookupOrder,
			createOrder,
			get payment() {
				return payment;
			},
			statusWrites,
			captureOrderIds,
			readOrderIds,
			createdOrderInputs,
			updatePayeeMerchantId: (merchantId: string) => {
				const payee = members[1];
				if (payee) payee.paypalMerchantId = merchantId;
			},
		};
	}

	test('pending capture stays active, survives remount, and completes on the same provider order', async () => {
		const fixture = createPayPalFixture({
			captureResponses: [completedOrder({ captureStatus: 'PENDING' }), completedOrder()],
		});
		const first = await fixture.capture();
		assert.equal(first.status, 202);
		assertMatchObject(await first.json(), { status: 'PENDING' });
		assert.equal(fixture.payment.status, 'capturing');

		const current = await fixture.lookupOrder();
		assert.equal(current.status, 200);
		const activeOrder = await current.json();
		assertMatchObject(activeOrder, { status: 'CAPTURING', orderId: providerOrderId });

		const duplicate = await fixture.createOrder();
		assert.equal(duplicate.status, 409);
		assert.deepEqual(await duplicate.json(), { error: 'paypal_order_in_progress' });

		const second = await fixture.capture(activeOrder.orderId);
		assert.equal(second.status, 200);
		assertMatchObject(await second.json(), {
			status: 'COMPLETED',
			amountCents: 1200,
			currency: 'EUR',
		});
		assert.equal(fixture.payment.status, 'completed');
		assert.deepEqual(fixture.captureOrderIds, [providerOrderId]);
		assert.deepEqual(fixture.readOrderIds, [providerOrderId]);
		assert.equal(fixture.createdOrderInputs.length, 0);
	});

	test('reservation placeholders are hidden from clients and cannot enter capture', async () => {
		const fixture = createPayPalFixture({ initialOrderId: 'pending:reservation' });
		const lookup = await fixture.lookupOrder();
		assert.deepEqual(await lookup.json(), { status: 'CREATING' });

		const capture = await fixture.capture('pending:reservation');
		assert.equal(capture.status, 409);
		assert.deepEqual(await capture.json(), { error: 'paypal_order_unavailable' });
		assert.equal(fixture.payment.status, 'created');
		assert.equal(fixture.captureOrderIds.length, 0);
	});

	test('a persisted capture reconciles before a reshaped debt graph can invalidate it', async () => {
		const aId = '00000000-0000-4000-8000-000000000001';
		const cId = '00000000-0000-4000-8000-000000000003';
		const eId = '00000000-0000-4000-8000-000000000005';
		const members = [
			{ id: aId, name: 'A', color: null, paypalMerchantId: null },
			{ id: payerId, name: 'B', color: null, paypalMerchantId: null },
			{ id: cId, name: 'C', color: null, paypalMerchantId: null },
			{ id: payeeId, name: 'D', color: null, paypalMerchantId: 'merchant-1' },
			{ id: eId, name: 'E', color: null, paypalMerchantId: null },
		];
		const expenses = [
			{
				paidByMemberId: payeeId,
				currency: 'EUR',
				occurredAt: '2026-09-27T00:00:00.000Z',
				splits: [
					{ debtorMemberId: aId, amountCents: 2_000, settledAt: null },
					{ debtorMemberId: payerId, amountCents: 1_000, settledAt: null },
				],
			},
			{
				paidByMemberId: eId,
				currency: 'EUR',
				occurredAt: '2026-09-27T00:00:00.000Z',
				splits: [
					{ debtorMemberId: payerId, amountCents: 500, settledAt: null },
					{ debtorMemberId: cId, amountCents: 1_000, settledAt: null },
				],
			},
		];
		const completedPayments = [
			{ fromMemberId: aId, toMemberId: payeeId, amountCents: 2_000, currency: 'EUR' },
		];
		const before = simplifyDebts(computeNetBalances(expenses, members, []));
		const after = simplifyDebts(computeNetBalances(expenses, members, completedPayments));
		assert.ok(
			before.some((item) => matchesObject(item, { fromId: payerId, toId: payeeId, cents: 1_000 })),
		);
		assert.equal(
			after.some((debt) => debt.fromId === payerId && debt.toId === payeeId),
			false,
		);

		const fixture = createPayPalFixture({
			initialStatus: 'capturing',
			initialAmountCents: 1_000,
			members,
			expenses,
			completedPayments,
			orderResponses: [completedOrder({ amount: '10.00' })],
		});
		const response = await fixture.capture();
		assert.equal(response.status, 200);
		assertMatchObject(await response.json(), { status: 'COMPLETED', amountCents: 1_000 });
		assert.equal(fixture.payment.status, 'completed');
		assert.deepEqual(fixture.readOrderIds, [providerOrderId]);
		assert.equal(fixture.captureOrderIds.length, 0);
	});

	test('a new capture stays unclaimed while another WG capture is pending', async () => {
		const fixture = createPayPalFixture({ anotherCaptureActive: true });
		const response = await fixture.capture();
		assert.equal(response.status, 202);
		assertMatchObject(await response.json(), { status: 'PENDING' });
		assert.equal(fixture.payment.status, 'created');
		assert.equal(fixture.captureOrderIds.length, 0);
		assert.equal(fixture.readOrderIds.length, 0);
		const lookup = await fixture.lookupOrder();
		assertMatchObject(await lookup.json(), { status: 'WAITING', orderId: providerOrderId });
	});

	test('an ambiguous order creation retries the same reservation with the same provider key', async () => {
		const fixture = createPayPalFixture({
			initialStatus: 'failed',
			createdOrderErrors: [new Error('create response lost')],
			createdOrderIds: ['paypal-order-created-once'],
		});
		const first = await fixture.createOrder();
		assert.equal(first.status, 500);
		assert.equal(fixture.payment.status, 'created');
		const reservationId = fixture.payment.id;
		assert.match(String(fixture.payment.providerOrderId), /^pending:/);

		const retry = await fixture.createOrder();
		assert.equal(retry.status, 200);
		assertMatchObject(await retry.json(), { orderId: 'paypal-order-created-once' });
		assert.equal(fixture.payment.id, reservationId);
		assert.equal(fixture.payment.providerOrderId, 'paypal-order-created-once');
		assert.equal(fixture.createdOrderInputs.length, 2);
		assert.equal(fixture.createdOrderInputs[0]?.requestId, reservationId);
		assert.equal(fixture.createdOrderInputs[1]?.requestId, reservationId);
	});

	test('a definitive Payee rejection frees the reservation for a corrected merchant', async () => {
		const fixture = createPayPalFixture({
			initialStatus: 'failed',
			createdOrderErrors: [new Error('paypal_api_422_PAYEE_ACCOUNT_INVALID')],
			createdOrderIds: ['paypal-order-after-correction'],
		});
		const first = await fixture.createOrder();
		assert.equal(first.status, 500);
		assert.equal(fixture.payment.status, 'failed');
		const rejectedRequestId = fixture.createdOrderInputs[0]?.requestId;

		fixture.updatePayeeMerchantId('merchant-corrected');
		const retry = await fixture.createOrder();
		assert.equal(retry.status, 200);
		assert.equal(fixture.payment.status, 'created');
		assert.equal(fixture.createdOrderInputs[1]?.payeeMerchantId, 'merchant-corrected');
		assert.notEqual(fixture.createdOrderInputs[1]?.requestId, rejectedRequestId);
	});

	test('a lost capture response is reconciled from PayPal without retrying a new order', async () => {
		const fixture = createPayPalFixture({
			captureResponses: [new Error('capture response lost')],
			orderResponses: [completedOrder()],
		});
		const response = await fixture.capture();
		assert.equal(response.status, 200);
		assertMatchObject(await response.json(), { status: 'COMPLETED' });
		assert.equal(fixture.payment.status, 'completed');
		assert.deepEqual(fixture.captureOrderIds, [providerOrderId]);
		assert.deepEqual(fixture.readOrderIds, [providerOrderId]);
	});

	test('an incomplete capture response is expanded with the same order before settlement', async () => {
		const fixture = createPayPalFixture({
			captureResponses: [{ id: providerOrderId, status: 'COMPLETED' }],
			orderResponses: [completedOrder()],
		});
		const response = await fixture.capture();
		assert.equal(response.status, 200);
		assertMatchObject(await response.json(), { status: 'COMPLETED' });
		assert.equal(fixture.payment.status, 'completed');
		assert.deepEqual(fixture.captureOrderIds, [providerOrderId]);
		assert.deepEqual(fixture.readOrderIds, [providerOrderId]);
	});

	test('an ambiguous capture stays pending when PayPal status lookup is unavailable', async () => {
		const fixture = createPayPalFixture({
			captureResponses: [new Error('capture response lost'), completedOrder()],
			orderResponses: [new Error('status lookup unavailable')],
		});
		const first = await fixture.capture();
		assert.equal(first.status, 202);
		assertMatchObject(await first.json(), { status: 'PENDING' });
		assert.equal(fixture.payment.status, 'capturing');

		const second = await fixture.capture();
		assert.equal(second.status, 200);
		assertMatchObject(await second.json(), { status: 'COMPLETED' });
		assert.equal(fixture.payment.status, 'completed');
	});

	test('definitive capture failure or a voided order releases the active payment', async () => {
		for (const [providerResult, expectedStatus] of [
			[completedOrder({ captureStatus: 'DECLINED' }), 'FAILED'],
			[{ id: providerOrderId, status: 'VOIDED', purchase_units: [] }, 'CANCELLED'],
		] as const) {
			const fixture = createPayPalFixture({ captureResponses: [providerResult] });
			const capture = await fixture.capture();
			assert.equal(capture.status, 200);
			assertMatchObject(await capture.json(), { status: expectedStatus });
			assert.equal(fixture.payment.status, 'failed');

			const replacement = await fixture.createOrder();
			assert.equal(replacement.status, 200);
			assertMatchObject(await replacement.json(), { orderId: 'paypal-order-replacement' });
			assert.equal(fixture.createdOrderInputs.length, 1);
		}
	});

	test('completed captures are not settled when provider payee, amount, or currency differs', async () => {
		for (const providerResult of [
			completedOrder({ merchantId: 'merchant-other' }),
			completedOrder({ amount: '11.99' }),
			completedOrder({ amount: '12.004' }),
			completedOrder({ currency: 'USD' }),
		]) {
			const fixture = createPayPalFixture({ captureResponses: [providerResult] });
			const response = await fixture.capture();
			assert.equal(response.status, 409);
			assert.deepEqual(await response.json(), { error: 'paypal_payment_not_completed' });
			// Not settled, and not left capturing: that would lock the whole WG's finances.
			assert.equal(fixture.payment.status, 'failed');
		}
	});

	test('provider results without the persisted order identity stay unresolved', async () => {
		const noOrderId = completedOrder();
		noOrderId.id = undefined;
		for (const providerResult of [noOrderId, { ...completedOrder(), id: 'paypal-other-order' }]) {
			const fixture = createPayPalFixture({ captureResponses: [providerResult] });
			const response = await fixture.capture();
			assert.equal(response.status, 202);
			assertMatchObject(await response.json(), { status: 'PENDING' });
			assert.equal(fixture.payment.status, 'capturing');
		}
	});

	test('a new capture is refused when its direct debt was replaced by an equal simplified path', async () => {
		const cId = '00000000-0000-4000-8000-000000000003';
		const members = [
			{ id: payerId, name: 'A', color: null, paypalMerchantId: null },
			{ id: payeeId, name: 'B', color: null, paypalMerchantId: 'merchant-1' },
			{ id: cId, name: 'C', color: null, paypalMerchantId: null },
		];
		const expenses: DebtExpenseInput[] = [
			{
				paidByMemberId: cId,
				currency: 'EUR',
				occurredAt: '2026-09-27T00:00:00.000Z',
				splits: [{ debtorMemberId: payerId, amountCents: 1_000, settledAt: null }],
			},
			{
				paidByMemberId: payeeId,
				currency: 'EUR',
				occurredAt: '2026-09-27T00:00:00.000Z',
				splits: [{ debtorMemberId: cId, amountCents: 1_000, settledAt: null }],
			},
		];

		assert.ok(
			simplifyDebts(computeNetBalances(expenses, members)).some((item) =>
				matchesObject(item, {
					fromId: payerId,
					toId: payeeId,
					cents: 1_000,
					currency: 'EUR',
				}),
			),
		);
		assert.equal(
			computeBalances(expenses).some(
				(debt) =>
					debt.debtorId === payerId && debt.creditorId === payeeId && debt.currency === 'EUR',
			),
			false,
		);

		const fixture = createPayPalFixture({
			initialAmountCents: 1_000,
			members,
			expenses,
			captureResponses: [completedOrder({ amount: '10.00' })],
		});
		const response = await fixture.capture();

		assert.equal(response.status, 409);
		assert.deepEqual(await response.json(), { error: 'debt_changed' });
		assert.equal(fixture.payment.status, 'failed');
		assert.deepEqual(fixture.captureOrderIds, []);
		assert.deepEqual(fixture.readOrderIds, []);
	});
});
