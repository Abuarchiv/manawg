import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PayPalApiError } from './paypal';

type PayPalInit = { method?: string; body?: string } | undefined;
type PayPalCall = { url: string; init: PayPalInit };

// Provider calls go to the test's own handler; the default answers with an empty object.
const paypalApi = {
	request: (async () => ({})) as (url: string, init?: PayPalInit) => Promise<unknown>,
};

mock.module('./paypal', {
	namedExports: {
		PayPalApiError,
		isPayPalConfigured: () => true,
		requestPayPalApi: (url: string, init?: PayPalInit) => paypalApi.request(url, init),
	},
});

const {
	createPayPalConnectionCookie,
	createPayPalPartnerReferral,
	getPayPalMerchantIdByTracking,
	getPayPalTrackingId,
	getSafePayPalActionUrl,
	isPayPalMerchantIntegrationReady,
	isPayPalMerchantReady,
	verifyPayPalConnectionCookie,
} = await import('./paypal-onboarding');

const binding = {
	trackingId: '8f3e7a22-11ab-4b13-9d1e-d3a42fd7b6c0',
	nonce: '9f3e7a22-11ab-4b13-9d1e-d3a42fd7b6c0',
	wgId: '1bc67a5a-5c08-4c0d-8eaf-520def98021a',
	memberId: '2bc67a5a-5c08-4c0d-8eaf-520def98021a',
	authUserId: '3bc67a5a-5c08-4c0d-8eaf-520def98021a',
	code: 'MTE8PZAT',
	environment: 'sandbox' as const,
	expiresAt: 1_800,
	expectedPreviousMerchantId: null,
};

test('PayPal connection cookie is signed and bound to member, WG, environment, and expiry', () => {
	process.env.PAYPAL_CLIENT_SECRET = 'test-secret-for-onboarding';
	const cookie = createPayPalConnectionCookie(binding);

	assert.deepEqual(
		verifyPayPalConnectionCookie(cookie, { environment: 'sandbox' }, 1_799),
		binding,
	);
	assert.equal(verifyPayPalConnectionCookie(`${cookie}x`, { environment: 'sandbox' }, 1_799), null);
	assert.equal(verifyPayPalConnectionCookie(cookie, { memberId: 'other' }, 1_799), null);
	assert.equal(verifyPayPalConnectionCookie(cookie, { environment: 'live' }, 1_799), null);
	assert.equal(verifyPayPalConnectionCookie(cookie, { environment: 'sandbox' }, 1_800), null);
});

test('partner tracking stays stable per auth user while remaining client-scoped and opaque', () => {
	const firstWg = getPayPalTrackingId(binding.authUserId, 'our-client', 'sandbox');
	const secondWg = getPayPalTrackingId(binding.authUserId, 'our-client', 'sandbox');
	assert.equal(firstWg, secondWg);
	assert.match(firstWg, /^[0-9a-f]{64}$/);
	assert.notEqual(firstWg, getPayPalTrackingId(binding.authUserId, 'our-client', 'live'));
	assert.notEqual(firstWg, getPayPalTrackingId(binding.authUserId, 'another-client', 'sandbox'));
	assert.notEqual(firstWg, getPayPalTrackingId('another-user', 'our-client', 'sandbox'));
});

test('PayPal action URL accepts only the exact environment host over HTTPS', () => {
	const valid = 'https://www.sandbox.paypal.com/partnerexp/appEntry?referralToken=abc';
	assert.equal(getSafePayPalActionUrl(valid, 'sandbox'), valid);
	assert.equal(getSafePayPalActionUrl('https://www.paypal.com/continue', 'sandbox'), null);
	assert.equal(
		getSafePayPalActionUrl('https://attacker@www.sandbox.paypal.com/continue', 'sandbox'),
		null,
	);
	assert.equal(
		getSafePayPalActionUrl('https://www.sandbox.paypal.com:8443/continue', 'sandbox'),
		null,
	);
	assert.equal(getSafePayPalActionUrl('http://www.sandbox.paypal.com/continue', 'sandbox'), null);
});

test('merchant readiness requires matching tracking, active checkout, and both scopes for our client', () => {
	const integration = {
		merchant_id: '2B23456789ABC',
		tracking_id: binding.trackingId,
		payments_receivable: true,
		primary_email_confirmed: true,
		products: [{ name: 'EXPRESS_CHECKOUT', status: 'ACTIVE' }],
		oauth_integrations: [
			{
				oauth_third_party: {
					partner_client_id: 'our-client',
					scopes: [
						'https://uri.paypal.com/services/payments/payment/authcapture',
						'https://uri.paypal.com/services/payments/realtimepayment',
					],
				},
			},
		],
	};

	assert.equal(
		isPayPalMerchantIntegrationReady(integration, 'our-client', binding.trackingId),
		true,
	);
	assert.equal(
		isPayPalMerchantIntegrationReady(integration, 'our-client', 'different-tracking'),
		false,
	);
	assert.equal(
		isPayPalMerchantIntegrationReady(integration, 'other-client', binding.trackingId),
		false,
	);
	assert.equal(
		isPayPalMerchantIntegrationReady(
			{ ...integration, payments_receivable: false },
			'our-client',
			binding.trackingId,
		),
		false,
	);
});

test('partner referral requests explicit consent and returns only PayPal generated action URLs', async () => {
	process.env.PAYPAL_ENV = 'sandbox';
	process.env.PAYPAL_CLIENT_ID = 'our-client';
	process.env.PAYPAL_CLIENT_SECRET = 'test-secret-for-onboarding';
	process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = 'BN-CODE';
	process.env.PAYPAL_PARTNER_MERCHANT_ID = '2A23456789ABC';
	process.env.NEXT_PUBLIC_APP_URL = 'https://manawg.example';
	const calls: PayPalCall[] = [];
	paypalApi.request = async (url, init) => {
		calls.push({ url, init });
		return {
			links: [
				{
					rel: 'action_url',
					href: 'https://www.sandbox.paypal.com/partnerexp/appEntry?referralToken=generated',
				},
			],
		};
	};

	const url = await createPayPalPartnerReferral({
		trackingId: binding.trackingId,
		nonce: binding.nonce,
		returnUrl: `https://manawg.example/api/paypal/return?state=${binding.nonce}`,
	});
	assert.equal(url, 'https://www.sandbox.paypal.com/partnerexp/appEntry?referralToken=generated');
	assert.equal(calls[0]?.url, '/v2/customer/partner-referrals');
	assert.equal(calls[0]?.init?.method, 'POST');
	assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), {
		tracking_id: binding.trackingId,
		operations: [
			{
				operation: 'API_INTEGRATION',
				api_integration_preference: {
					rest_api_integration: {
						integration_method: 'PAYPAL',
						integration_type: 'THIRD_PARTY',
						third_party_details: { features: ['PAYMENT'] },
					},
				},
			},
		],
		products: ['EXPRESS_CHECKOUT'],
		legal_consents: [{ type: 'SHARE_DATA_CONSENT', granted: true }],
		partner_config_override: {
			return_url: `https://manawg.example/api/paypal/return?state=${binding.nonce}`,
		},
	});
});

test('a provider 404 means the saved merchant is disconnected, while other failures still throw', async () => {
	process.env.PAYPAL_ENV = 'sandbox';
	process.env.PAYPAL_CLIENT_ID = 'our-client';
	process.env.PAYPAL_CLIENT_SECRET = 'test-secret-for-onboarding';
	process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = 'BN-CODE';
	process.env.PAYPAL_PARTNER_MERCHANT_ID = '2A23456789ABC';
	process.env.NEXT_PUBLIC_APP_URL = 'https://manawg.example';
	paypalApi.request = async () => {
		throw new PayPalApiError(404, null);
	};
	assert.equal(await isPayPalMerchantReady('2B23456789ABC'), false);
	// A plain Error that merely carries the message is not a provider 404.
	paypalApi.request = async () => {
		throw new Error('paypal_api_404');
	};
	await assert.rejects(isPayPalMerchantReady('2B23456789ABC'), /paypal_api_404/);
	paypalApi.request = async () => {
		throw new PayPalApiError(503, null);
	};
	await assert.rejects(isPayPalMerchantReady('2B23456789ABC'), /paypal_api_503/);
});

test('tracking lookup accepts only the documented single object with exact tracking and valid merchant ID', async () => {
	process.env.PAYPAL_ENV = 'sandbox';
	process.env.PAYPAL_CLIENT_ID = 'our-client';
	process.env.PAYPAL_CLIENT_SECRET = 'test-secret-for-onboarding';
	process.env.PAYPAL_PARTNER_MERCHANT_ID = '2A23456789ABC';
	process.env.NEXT_PUBLIC_APP_URL = 'https://manawg.example';
	for (const response of [
		{ merchant_id: '2B23456789ABC', tracking_id: binding.trackingId },
		null,
		[],
		[{ merchant_id: '2B23456789ABC', tracking_id: binding.trackingId }],
		{ merchant_id: '2B23456789ABC', tracking_id: 'different' },
		{ merchant_id: 'not-a-merchant', tracking_id: binding.trackingId },
		{ merchants: [{ merchant_id: '2B23456789ABC', tracking_id: binding.trackingId }] },
	]) {
		const calls: PayPalCall[] = [];
		paypalApi.request = async (url, init) => {
			calls.push({ url, init });
			return response;
		};
		const result = await getPayPalMerchantIdByTracking(binding.trackingId);
		assert.equal(
			result,
			!Array.isArray(response) &&
				response?.merchant_id === '2B23456789ABC' &&
				response.tracking_id === binding.trackingId
				? '2B23456789ABC'
				: null,
		);
		assert.deepEqual(calls, [
			{
				url: `/v1/customer/partners/2A23456789ABC/merchant-integrations?tracking_id=${encodeURIComponent(binding.trackingId)}`,
				init: { method: 'GET' },
			},
		]);
	}
	paypalApi.request = async () => {
		throw new PayPalApiError(404, null);
	};
	await assert.rejects(getPayPalMerchantIdByTracking(binding.trackingId), /paypal_api_404/);
});
