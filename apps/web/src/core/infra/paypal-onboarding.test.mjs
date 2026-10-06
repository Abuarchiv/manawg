import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));

function loadOnboarding(overrides = {}) {
	const source = readFileSync('src/core/infra/paypal-onboarding.ts', 'utf8');
	const compiled = transpileModule(source, {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const loaded = { exports: {} };
	const dependencies = {
		...overrides,
		'./paypal': {
			isPayPalConfigured: () => true,
			requestPayPalApi: async () => ({}),
			...overrides['./paypal'],
		},
	};
	new Function('require', 'module', 'exports', compiled)(
		(name) => (name in dependencies ? dependencies[name] : requireFromWeb(name)),
		loaded,
		loaded.exports,
	);
	return loaded.exports;
}

const binding = {
	trackingId: '8f3e7a22-11ab-4b13-9d1e-d3a42fd7b6c0',
	nonce: '9f3e7a22-11ab-4b13-9d1e-d3a42fd7b6c0',
	wgId: '1bc67a5a-5c08-4c0d-8eaf-520def98021a',
	memberId: '2bc67a5a-5c08-4c0d-8eaf-520def98021a',
	authUserId: '3bc67a5a-5c08-4c0d-8eaf-520def98021a',
	code: 'MTE8PZAT',
	environment: 'sandbox',
	expiresAt: 1_800,
	expectedPreviousMerchantId: null,
};

test('partner referral requests explicit consent and returns only PayPal generated action URLs', async () => {
	process.env.PAYPAL_ENV = 'sandbox';
	process.env.PAYPAL_CLIENT_ID = 'our-client';
	process.env.PAYPAL_CLIENT_SECRET = 'test-secret-for-onboarding';
	process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = 'BN-CODE';
	process.env.PAYPAL_PARTNER_MERCHANT_ID = '2A23456789ABC';
	process.env.NEXT_PUBLIC_APP_URL = 'https://manawg.example';
	const calls = [];
	const { createPayPalPartnerReferral } = loadOnboarding({
		'./paypal': {
			requestPayPalApi: async (url, init) => {
				calls.push({ url, init });
				return {
					links: [
						{
							rel: 'action_url',
							href: 'https://www.sandbox.paypal.com/partnerexp/appEntry?referralToken=generated',
						},
					],
				};
			},
		},
	});

	const url = await createPayPalPartnerReferral({
		trackingId: binding.trackingId,
		nonce: binding.nonce,
		returnUrl: `https://manawg.example/api/paypal/return?state=${binding.nonce}`,
	});
	assert.equal(url, 'https://www.sandbox.paypal.com/partnerexp/appEntry?referralToken=generated');
	assert.equal(calls[0].url, '/v2/customer/partner-referrals');
	assert.equal(calls[0].init.method, 'POST');
	assert.deepEqual(JSON.parse(calls[0].init.body), {
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
	const { isPayPalMerchantReady } = loadOnboarding({
		'./paypal': {
			requestPayPalApi: async () => {
				throw new Error('paypal_api_404');
			},
		},
	});
	assert.equal(await isPayPalMerchantReady('2B23456789ABC'), false);
	const { isPayPalMerchantReady: unavailable } = loadOnboarding({
		'./paypal': {
			requestPayPalApi: async () => {
				throw new Error('paypal_api_503');
			},
		},
	});
	await assert.rejects(unavailable('2B23456789ABC'), /paypal_api_503/);
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
		const calls = [];
		const { getPayPalMerchantIdByTracking } = loadOnboarding({
			'./paypal': {
				requestPayPalApi: async (url, init) => {
					calls.push({ url, init });
					return response;
				},
			},
		});
		const result = await getPayPalMerchantIdByTracking(binding.trackingId);
		assert.equal(
			result,
			response?.merchant_id === '2B23456789ABC' && response.tracking_id === binding.trackingId
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
	const { getPayPalMerchantIdByTracking } = loadOnboarding({
		'./paypal': {
			requestPayPalApi: async () => {
				throw new Error('paypal_api_404');
			},
		},
	});
	await assert.rejects(getPayPalMerchantIdByTracking(binding.trackingId), /paypal_api_404/);
});
