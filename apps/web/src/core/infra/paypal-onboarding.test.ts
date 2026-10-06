import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPayPalConnectionCookie,
	getPayPalTrackingId,
	getSafePayPalActionUrl,
	isPayPalMerchantIntegrationReady,
	verifyPayPalConnectionCookie,
} from './paypal-onboarding';

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
