import assert from 'node:assert/strict';
import test from 'node:test';
import {
	contentSecurityPolicy,
	crossOriginOpenerPolicy,
	isPayPalSdkEnabled,
} from '../src/core/infra/security-headers.ts';

const payPalOrigins = ['https://www.paypal.com', 'https://www.sandbox.paypal.com'];
const ocrLanguageDataUrls = [
	'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz',
	'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
];

function directives(policy) {
	return new Map(
		policy.split(';').map((entry) => {
			const [name, ...sources] = entry.trim().split(/\s+/);
			return [name, sources];
		}),
	);
}

test('PayPal CSP grants only the exact SDK hosts and uses the document nonce', () => {
	const policy = directives(contentSecurityPolicy('request-nonce', true, true));

	for (const name of ['connect-src', 'frame-src']) {
		for (const origin of payPalOrigins)
			assert.ok(policy.get(name)?.includes(origin), `${name} includes ${origin}`);
	}
	assert.ok(policy.get('script-src')?.includes("'nonce-request-nonce'"));
	assert.ok(policy.get('style-src')?.includes("'nonce-request-nonce'"));
	// Ersetzt das gelöschte check-security-boundaries-Script: Nonce-CSP darf nie auf unsafe-inline zurückfallen.
	assert.doesNotMatch(policy.get('script-src').join(' '), /unsafe-inline/);
	assert.doesNotMatch(policy.get('style-src').join(' '), /unsafe-inline/);
	assert.ok(policy.get('frame-src')?.includes("'self'"));
	assert.doesNotMatch(policy.get('connect-src').join(' '), /\*\.paypal|paypalobjects|venmo/i);
	assert.doesNotMatch(policy.get('frame-src').join(' '), /\*\.paypal|paypalobjects|venmo/i);
	for (const name of ['script-src', 'style-src', 'img-src'])
		assert.doesNotMatch(policy.get(name).join(' '), /paypal|venmo/i);
	assert.equal(crossOriginOpenerPolicy(true), 'same-origin-allow-popups');
});

test('PayPal hosts and popup policy stay disabled without both public SDK keys', () => {
	const noConfig = {};
	const partialConfig = { NEXT_PUBLIC_PAYPAL_CLIENT_ID: 'client-id' };
	const fullConfig = {
		NEXT_PUBLIC_PAYPAL_CLIENT_ID: 'client-id',
		NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID: 'partner-id',
	};

	assert.equal(isPayPalSdkEnabled(noConfig.NEXT_PUBLIC_PAYPAL_CLIENT_ID, undefined), false);
	assert.equal(
		isPayPalSdkEnabled(
			partialConfig.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
			partialConfig.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
		),
		false,
	);
	assert.equal(
		isPayPalSdkEnabled(
			fullConfig.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
			fullConfig.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
		),
		true,
	);
	assert.equal(crossOriginOpenerPolicy(false), 'same-origin');
	assert.doesNotMatch(contentSecurityPolicy('request-nonce', true, false), /paypal|venmo/i);
});

test('Tesseract gets WASM compilation and only its pinned German and English data files', () => {
	const previousNodeEnv = process.env.NODE_ENV;
	try {
		process.env.NODE_ENV = 'production';
		const policy = directives(contentSecurityPolicy('ocr-nonce', true, false));
		const scriptSrc = policy.get('script-src');
		const connectSrc = policy.get('connect-src');

		assert.ok(scriptSrc.includes("'wasm-unsafe-eval'"));
		assert.ok(!scriptSrc.includes("'unsafe-eval'"));
		for (const url of ocrLanguageDataUrls)
			assert.ok(connectSrc.includes(url), `connect-src includes ${url}`);
		assert.ok(!connectSrc.includes('https://cdn.jsdelivr.net'));
		assert.equal(
			connectSrc.filter((source) => source.startsWith('https://cdn.jsdelivr.net')).length,
			ocrLanguageDataUrls.length,
		);
	} finally {
		process.env.NODE_ENV = previousNodeEnv ?? '';
	}
});

test('Supabase image storage drops S3 as an upload target but keeps reading legacy S3 pictures', () => {
	const previous = process.env.IMAGE_STORAGE_PROVIDER;
	const previousBucket = process.env.S3_BUCKET;
	const previousRegion = process.env.AWS_REGION;
	try {
		process.env.S3_BUCKET = 'legacy-bucket';
		process.env.AWS_REGION = 'eu-central-1';

		process.env.IMAGE_STORAGE_PROVIDER = 'supabase';
		const supabasePolicy = directives(contentSecurityPolicy('nonce', true, false));
		assert.doesNotMatch(supabasePolicy.get('connect-src')?.join(' ') ?? '', /amazonaws/);
		assert.ok(supabasePolicy.get('img-src')?.includes('https://*.amazonaws.com'));

		process.env.IMAGE_STORAGE_PROVIDER = 'aws';
		const awsPolicy = directives(contentSecurityPolicy('nonce', true, false));
		assert.match(awsPolicy.get('connect-src')?.join(' ') ?? '', /legacy-bucket/);
		assert.ok(awsPolicy.get('media-src')?.includes('https://*.amazonaws.com'));
	} finally {
		for (const [name, value] of [
			['IMAGE_STORAGE_PROVIDER', previous],
			['S3_BUCKET', previousBucket],
			['AWS_REGION', previousRegion],
		]) {
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
	}
});
