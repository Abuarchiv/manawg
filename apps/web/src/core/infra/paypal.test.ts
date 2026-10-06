import assert from 'node:assert/strict';
import test from 'node:test';
import {
	capturePayPalOrder,
	createPayPalOrder,
	isTerminalPayPalOrderCreationError,
	requestPayPalApi,
} from './paypal';

test('only definitive Payee account errors release an order-creation reservation', () => {
	assert.equal(
		isTerminalPayPalOrderCreationError(new Error('paypal_api_422_PAYEE_ACCOUNT_INVALID')),
		true,
	);
	assert.equal(
		isTerminalPayPalOrderCreationError(new Error('paypal_api_422_DUPLICATE_REQUEST_ID')),
		false,
	);
	assert.equal(isTerminalPayPalOrderCreationError(new Error('paypal_api_503')), false);
});

test('PayPal API helper keeps onboarding status errors, PAYEE classification, and replay headers', async (t) => {
	const environmentNames = [
		'PAYPAL_ENV',
		'PAYPAL_CLIENT_ID',
		'PAYPAL_CLIENT_SECRET',
		'PAYPAL_PARTNER_ATTRIBUTION_ID',
	];
	const previousEnvironment = Object.fromEntries(
		environmentNames.map((name) => [name, process.env[name]]),
	);
	process.env.PAYPAL_ENV = 'sandbox';
	process.env.PAYPAL_CLIENT_ID = 'test-client';
	process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
	process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = 'BN-CODE';
	t.after(() => {
		for (const name of environmentNames) {
			const previous = previousEnvironment[name];
			if (previous === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = previous;
		}
	});

	const calls: { url: string; headers: Headers }[] = [];
	let responseMode = 'payee-error';
	t.mock.method(globalThis, 'fetch', async (input: unknown, init: RequestInit = {}) => {
		const url = String(input);
		calls.push({ url, headers: new Headers(init.headers ?? {}) });
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
							captures: [{ status: 'COMPLETED', amount: { currency_code: 'EUR', value: '12.34' } }],
						},
					},
				],
			});
		}
		return Response.json({ id: 'paypal-order', status: 'CREATED' });
	});

	assert.equal(
		isTerminalPayPalOrderCreationError(new Error('paypal_api_403_PAYEE_ACCOUNT_RESTRICTED')),
		true,
	);
	assert.equal(
		isTerminalPayPalOrderCreationError(new Error('paypal_api_503_PAYEE_ACCOUNT_RESTRICTED')),
		false,
	);
	assert.equal(isTerminalPayPalOrderCreationError(new Error('paypal_api_403')), false);

	await assert.rejects(
		requestPayPalApi('/v2/checkout/orders', { method: 'POST' }, '2B23456789ABC'),
		/paypal_api_403_PAYEE_ACCOUNT_RESTRICTED/,
	);
	assert.ok(calls.at(-1)?.headers.get('PayPal-Auth-Assertion'));

	responseMode = 'onboarding-404';
	await assert.rejects(
		requestPayPalApi('/v1/merchant-integrations', { method: 'GET' }),
		/paypal_api_404$/,
	);
	assert.equal(calls.at(-1)?.headers.get('PayPal-Auth-Assertion'), null);

	responseMode = 'success';
	const created = await createPayPalOrder({
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

	const capture = await capturePayPalOrder('paypal-order', '2B23456789ABC');
	const captureRequest = calls.find((call) => call.url.endsWith('/capture'));
	assert.equal(captureRequest?.headers.get('PayPal-Request-Id'), 'paypal-order');
	assert.equal(captureRequest?.headers.get('Prefer'), 'return=representation');
	assert.equal(capture.status, 'COMPLETED');
	const [unit] = capture.purchase_units ?? [];
	assert.equal(unit?.payee?.merchant_id, '2B23456789ABC');
	assert.equal(unit?.payments?.captures?.[0]?.amount?.value, '12.34');
});
