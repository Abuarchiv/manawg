import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const wgId = '1bc67a5a-5c08-4c0d-8eaf-520def98021a';
const fromMemberId = '2bc67a5a-5c08-4c0d-8eaf-520def98021a';
const toMemberId = '3bc67a5a-5c08-4c0d-8eaf-520def98021a';

// The real provider client stays in place for the API-helper test; the route sees a faked subset.
const realPayPal = await import('@/core/infra/paypal');

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

interface Condition {
	kind: string;
	conditions?: Condition[];
	field?: string;
	value?: unknown;
	values?: unknown[];
}
type Row = Record<string, unknown>;
interface PaymentRow extends Row {
	id: string;
	status: string;
	providerOrderId: string;
}
interface Update {
	status?: string;
	providerOrderId?: string;
}
interface OrderRequest {
	requestId: string;
}

// The scenario of the harness that issued the current request; mocks read it at call time.
interface Active {
	tx: unknown;
	isPayPalMerchantReady: () => Promise<boolean>;
	createPayPalOrder: (input: OrderRequest) => Promise<{ id: string }>;
	drizzle: {
		and: (...conditions: unknown[]) => unknown;
		eq: (field: unknown, value: unknown) => unknown;
		inArray: (field: unknown, values: unknown) => unknown;
		lte: (field: unknown, value: unknown) => unknown;
	};
}
let active: Active;

mock.module('@/core/db', { namedExports: { db: {}, expensePayments, wgMembers } });
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId },
			member: { memberId: fromMemberId },
		}),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/infra/paypal', {
	namedExports: {
		isPayPalConfigured: () => true,
		isTerminalPayPalOrderCreationError: realPayPal.isTerminalPayPalOrderCreationError,
		createPayPalOrder: (input: OrderRequest) => active.createPayPalOrder(input),
	},
});
mock.module('@/core/infra/paypal-onboarding', {
	namedExports: { isPayPalMerchantReady: () => active.isPayPalMerchantReady() },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/features/expenses/debt-reduction', {
	namedExports: {
		computeNetBalances: () => [],
		simplifyDebts: () => [
			{ fromId: fromMemberId, toId: toMemberId, cents: 1_000, currency: 'EUR' },
		],
	},
});
mock.module('@/features/expenses/debts', {
	namedExports: {
		computeBalances: () => [
			{ debtorId: fromMemberId, creditorId: toMemberId, amountCents: 1_000, currency: 'EUR' },
		],
	},
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: {
		PAYPAL_ORDER_TTL_MS: 60_000,
		loadCompletedExpensePayments: async () => [],
		withExpensePaymentLock: async (_id: string, operation: (tx: unknown) => unknown) =>
			operation(active.tx),
	},
});
mock.module('@/features/expenses/server/open-expenses', {
	namedExports: { loadOpenExpenses: async () => [] },
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => active.drizzle.and(...conditions),
		eq: (field: unknown, value: unknown) => active.drizzle.eq(field, value),
		inArray: (field: unknown, values: unknown) => active.drizzle.inArray(field, values),
		lte: (field: unknown, value: unknown) => active.drizzle.lte(field, value),
		sql: (parts: unknown, ...values: unknown[]) => ({ kind: 'sql', parts, values }),
	},
});

const { POST } = await import('./route');

function postOrder() {
	return POST(
		new Request('https://manawg.example/api/paypal/order', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fromMemberId, toMemberId, currency: 'EUR' }),
		}) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
	);
}

function makeOrderHarness({
	isPayPalMerchantReady,
	createPayPalOrder,
}: {
	isPayPalMerchantReady: () => Promise<boolean>;
	createPayPalOrder: (input: OrderRequest) => Promise<{ id: string }>;
}) {
	const members = [
		{ id: fromMemberId, wgId, name: 'Payer', color: 'blue', paypalMerchantId: null },
		{ id: toMemberId, wgId, name: 'Payee', color: 'green', paypalMerchantId: '2B23456789ABC' },
	];
	// `payment` stays unset until the route reserves one.
	const state = { payment: null as unknown as PaymentRow, failedUpdates: 0 };

	function matches(row: Row, condition: Condition | null | undefined): boolean {
		if (!condition) return true;
		const field = condition.field as string;
		if (condition.kind === 'and') {
			return (condition.conditions ?? []).every((part) => matches(row, part));
		}
		if (condition.kind === 'eq') return row[field] === condition.value;
		if (condition.kind === 'in') return (condition.values ?? []).includes(row[field]);
		if (condition.kind === 'lte') return (row[field] as Date) <= (condition.value as Date);
		return true;
	}

	function queryBuilder() {
		let rows: Row[] = [];
		const query = Promise.resolve().then(() => rows);
		Object.assign(query, {
			from(table: unknown) {
				rows =
					table === wgMembers
						? members
						: table === expensePayments && state.payment
							? [{ ...state.payment, orderId: state.payment.providerOrderId }]
							: [];
				return query;
			},
			where(condition: Condition) {
				rows = rows.filter((row) => matches(row, condition));
				return query;
			},
			limit(count: number) {
				return Promise.resolve(rows.slice(0, count));
			},
		});
		return query;
	}

	const tx = {
		select: () => queryBuilder(),
		insert: () => ({
			values: (values: Row) => ({
				onConflictDoNothing: () => ({
					returning: async () => {
						if (state.payment) return [];
						state.payment = { ...values, id: 'payment-id', status: 'created' } as PaymentRow;
						return [{ id: state.payment.id }];
					},
				}),
			}),
		}),
		update: () => ({
			set: (updates: Update) => ({
				where: async (condition: Condition) => {
					const matched = Boolean(state.payment && matches(state.payment, condition));
					if (matched) {
						Object.assign(state.payment, updates);
						if (updates.status === 'failed') state.failedUpdates += 1;
					}
					return {
						returning: async () => (matched ? [{ id: state.payment.id }] : []),
					};
				},
			}),
		}),
	};
	const orderRequests: OrderRequest[] = [];
	const own: Active = {
		tx,
		isPayPalMerchantReady,
		createPayPalOrder: async (input) => {
			orderRequests.push(input);
			return createPayPalOrder(input);
		},
		drizzle: {
			and: (...conditions) => ({ kind: 'and', conditions }),
			eq: (field, value) => ({ kind: 'eq', field, value }),
			inArray: (field, values) => ({ kind: 'in', field, values }),
			lte: (field, value) => ({ kind: 'lte', field, value }),
		},
	};
	const post = () => {
		active = own;
		return postOrder();
	};
	return { post, state, orderRequests };
}

test('new PayPal order is refused when the recipient has lost provider readiness', async () => {
	const members = [
		{ id: fromMemberId, name: 'Payer', color: 'blue', paypalMerchantId: null },
		{ id: toMemberId, name: 'Payee', color: 'green', paypalMerchantId: '2B23456789ABC' },
	];
	const state = { created: 0, failed: false };
	const tx = {
		select: () => {
			let rows: unknown[] = [];
			const query = Promise.resolve().then(() => rows);
			return Object.assign(query, {
				from(value: unknown) {
					rows = value === wgMembers ? members : [];
					return query;
				},
				where() {
					return query;
				},
				limit: async () => [],
			});
		},
		insert: () => ({
			values: () => ({
				onConflictDoNothing: () => ({ returning: async () => [{ id: 'payment-id' }] }),
			}),
		}),
		update: () => ({
			set: (values: Update) => ({
				where: async () => {
					if (values.status === 'failed') state.failed = true;
				},
			}),
		}),
	};
	active = {
		tx,
		isPayPalMerchantReady: async () => false,
		createPayPalOrder: async () => {
			state.created += 1;
			return { id: 'order-id' };
		},
		drizzle: { and: () => null, eq: () => null, inArray: () => null, lte: () => null },
	};
	const response = await postOrder();
	assert.equal(response.status, 409);
	assert.equal((await response.json()).error, 'paypal_onboarding_pending');
	assert.equal(state.created, 0);
	assert.equal(state.failed, true);
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
		const harness = makeOrderHarness({
			isPayPalMerchantReady: async () => {
				notifyReadinessStarted();
				return readinessGate;
			},
			createPayPalOrder: async () => {
				throw new Error('order creation must not run after readiness was denied');
			},
		});

		const pendingRequest = harness.post();
		await readinessStarted;
		const paymentId = harness.state.payment.id;
		const pendingOrderId = harness.state.payment.providerOrderId;
		assert.equal(harness.state.payment.status, 'created');
		assert.match(pendingOrderId, /^pending:/);

		// Another request may move the row while PayPal's readiness lookup waits.
		Object.assign(harness.state.payment, finalState);
		releaseReadiness(false);
		const response = await pendingRequest;
		assert.equal(response.status, 409);
		assert.equal((await response.json()).error, 'paypal_onboarding_pending');
		assert.equal(harness.state.payment.id, paymentId);
		assert.equal(harness.state.payment.status, finalState.status);
		assert.equal(harness.state.payment.providerOrderId, finalState.providerOrderId);
		assert.equal(harness.state.failedUpdates, 0);
		assert.equal(harness.orderRequests.length, 0);
	}
});
test('readiness and provider availability failures retry the same pending payment id', async () => {
	let readinessCalls = 0;
	let createCalls = 0;
	const harness = makeOrderHarness({
		isPayPalMerchantReady: async () => {
			readinessCalls += 1;
			if (readinessCalls === 1) throw new realPayPal.PayPalApiError(503, null);
			return true;
		},
		createPayPalOrder: async () => {
			createCalls += 1;
			if (createCalls === 1) throw new realPayPal.PayPalApiError(503, null);
			return { id: 'paypal-order-recovered' };
		},
	});

	const readinessFailure = await harness.post();
	assert.equal(readinessFailure.status, 500);
	const paymentId = harness.state.payment.id;
	const pendingOrderId = harness.state.payment.providerOrderId;
	assert.match(pendingOrderId, /^pending:/);
	assert.equal(harness.state.payment.status, 'created');
	assert.equal(harness.state.failedUpdates, 0);
	assert.equal(harness.orderRequests.length, 0);

	const providerFailure = await harness.post();
	assert.equal(providerFailure.status, 500);
	assert.equal(harness.state.payment.id, paymentId);
	assert.equal(harness.state.payment.providerOrderId, pendingOrderId);
	assert.equal(harness.state.payment.status, 'created');
	assert.equal(harness.orderRequests.length, 1);
	assert.equal(harness.orderRequests[0]?.requestId, paymentId);
	assert.equal(harness.state.failedUpdates, 0);

	const recovered = await harness.post();
	assert.equal(recovered.status, 200);
	assert.equal(harness.state.payment.id, paymentId);
	assert.equal(harness.state.payment.providerOrderId, 'paypal-order-recovered');
	assert.equal(harness.orderRequests.length, 2);
	assert.deepEqual(
		harness.orderRequests.map((request) => request.requestId),
		[paymentId, paymentId],
	);
	assert.equal(harness.state.failedUpdates, 0);
});

test('PayPal API helper keeps onboarding status errors, PAYEE classification, and replay headers', async () => {
	const environmentNames = [
		'PAYPAL_ENV',
		'PAYPAL_CLIENT_ID',
		'PAYPAL_CLIENT_SECRET',
		'PAYPAL_PARTNER_ATTRIBUTION_ID',
	];
	const previousEnvironment = Object.fromEntries(
		environmentNames.map((name) => [name, process.env[name]]),
	);
	const previousFetch = globalThis.fetch;
	process.env.PAYPAL_ENV = 'sandbox';
	process.env.PAYPAL_CLIENT_ID = 'test-client';
	process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
	process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = 'BN-CODE';

	const calls: { url: string; headers: Headers; init: RequestInit }[] = [];
	let responseMode = 'payee-error';
	globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
		const url = String(input);
		const headers = new Headers(init.headers ?? {});
		calls.push({ url, headers, init });
		if (url.endsWith('/v1/oauth2/token')) {
			return Response.json({ access_token: 'test-access-token', expires_in: 300 });
		}
		if (responseMode === 'payee-error') {
			return Response.json({ details: [{ issue: 'PAYEE_ACCOUNT_RESTRICTED' }] }, { status: 403 });
		}
		if (responseMode === 'onboarding-404') {
			return Response.json({ details: [{ issue: 'PAYEE_ACCOUNT_RESTRICTED' }] }, { status: 404 });
		}
		if (url.endsWith('/capture')) {
			return Response.json({
				id: 'paypal-order',
				status: 'COMPLETED',
				purchase_units: [
					{
						payee: { merchant_id: '2B23456789ABC' },
						payments: {
							captures: [
								{
									status: 'COMPLETED',
									amount: { currency_code: 'EUR', value: '12.34' },
								},
							],
						},
					},
				],
			});
		}
		return Response.json({ id: 'paypal-order', status: 'CREATED' });
	}) as typeof fetch;

	try {
		const paypal = realPayPal;
		assert.equal(
			paypal.isTerminalPayPalOrderCreationError(
				new realPayPal.PayPalApiError(403, 'PAYEE_ACCOUNT_RESTRICTED'),
			),
			true,
		);
		assert.equal(
			paypal.isTerminalPayPalOrderCreationError(
				new realPayPal.PayPalApiError(503, 'PAYEE_ACCOUNT_RESTRICTED'),
			),
			false,
		);
		assert.equal(
			paypal.isTerminalPayPalOrderCreationError(new realPayPal.PayPalApiError(403, null)),
			false,
		);

		await assert.rejects(
			paypal.requestPayPalApi('/v2/checkout/orders', { method: 'POST' }, '2B23456789ABC'),
			/paypal_api_403_PAYEE_ACCOUNT_RESTRICTED/,
		);
		assert.ok(calls.at(-1)?.headers.get('PayPal-Auth-Assertion'));

		responseMode = 'onboarding-404';
		await assert.rejects(
			paypal.requestPayPalApi('/v1/merchant-integrations', { method: 'GET' }),
			/paypal_api_404$/,
		);
		assert.equal(calls.at(-1)?.headers.get('PayPal-Auth-Assertion'), null);

		responseMode = 'success';
		const created = await paypal.createPayPalOrder({
			amountCents: 1_234,
			currency: 'EUR',
			description: 'Miete',
			payeeMerchantId: '2B23456789ABC',
			customId: 'manawg:wg:payment-id',
			requestId: 'payment-id',
		});
		assert.equal(created.id, 'paypal-order');
		const createRequest = calls.filter((call) => call.url.endsWith('/v2/checkout/orders')).at(-1);
		assert.equal(createRequest?.headers.get('PayPal-Request-Id'), 'payment-id');

		const capture = await paypal.capturePayPalOrder('paypal-order', '2B23456789ABC');
		const captureRequest = calls.find((call) => call.url.endsWith('/capture'));
		assert.equal(captureRequest?.headers.get('PayPal-Request-Id'), 'paypal-order');
		assert.equal(captureRequest?.headers.get('Prefer'), 'return=representation');
		assert.equal(capture.status, 'COMPLETED');
		assert.equal(capture.purchase_units?.[0]?.payee?.merchant_id, '2B23456789ABC');
		assert.equal(capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value, '12.34');
	} finally {
		globalThis.fetch = previousFetch;
		for (const name of environmentNames) {
			if (previousEnvironment[name] === undefined) delete process.env[name];
			else process.env[name] = previousEnvironment[name] as string;
		}
	}
});
