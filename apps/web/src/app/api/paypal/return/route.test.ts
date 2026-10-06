import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { importUnmocked, request } from '../../../../../tests/support/route-harness';

type Onboarding = typeof import('@/core/infra/paypal-onboarding');

const code = 'MTE8PZAT';
const merchantId = '2B23456789ABC';
const cookieName = 'manawg_paypal_connection';
const callbackNonce = '9f3e7a22-11ab-4b13-9d1e-d3a42fd7b6c0';

const realOnboarding = (await importUnmocked('core/infra/paypal-onboarding.ts')) as Onboarding;

mock.module('@/core/infra/paypal-onboarding', {
	namedExports: {
		PAYPAL_CONNECTION_COOKIE_NAME: cookieName,
		getPayPalEnvironment: () => 'sandbox',
		getTrustedPayPalAppOrigin: () => 'https://manawg.example',
		isPayPalMerchantId: (value: unknown) => value === merchantId,
		readPayPalConnectionCookie: realOnboarding.readPayPalConnectionCookie,
		verifyPayPalConnectionCookie: (value: string | undefined) =>
			value === 'valid-cookie' ? { environment: 'sandbox', code, nonce: callbackNonce } : null,
	},
});

const { GET } = await import('./route');

const callback = (query: string) =>
	GET(
		request(`/api/paypal/return?${query}`, { headers: { cookie: `${cookieName}=valid-cookie` } }),
	);

test('generic PayPal return ignores caller destinations and malformed merchant hints', () => {
	const response = callback(
		`state=${callbackNonce}&code=EVILCODE&next=https%3A%2F%2Fevil.test&merchantIdInPayPal=${merchantId}`,
	);
	assert.equal(response.status, 303);
	assert.equal(
		response.headers.get('location'),
		`https://manawg.example/wg/${code}/einstellungen?paypal=return&merchantIdInPayPal=${merchantId}`,
	);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.equal(response.headers.get('referrer-policy'), 'no-referrer');

	const invalidHint = callback(`state=${callbackNonce}&merchantIdInPayPal=javascript%3Aalert(1)`);
	assert.equal(
		invalidHint.headers.get('location'),
		`https://manawg.example/wg/${code}/einstellungen?paypal=return`,
	);
	const mismatchedState = callback('state=other');
	assert.equal(mismatchedState.headers.get('location'), 'https://manawg.example/');
});
