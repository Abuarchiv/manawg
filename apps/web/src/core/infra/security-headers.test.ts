import assert from 'node:assert/strict';
import test from 'node:test';
import {
	contentSecurityPolicy,
	crossOriginOpenerPolicy,
	isPayPalSdkEnabled,
} from './security-headers';

const payPalOrigins = ['https://www.paypal.com', 'https://www.sandbox.paypal.com'];
const ocrLanguageDataUrls = [
	'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz',
	'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
];

function directives(policy: string): Map<string | undefined, string[]> {
	return new Map(
		policy.split(';').map((entry) => {
			const [name, ...sources] = entry.trim().split(/\s+/);
			return [name, sources];
		}),
	);
}

function sourcesOf(policy: Map<string | undefined, string[]>, name: string): string {
	const sources = policy.get(name);
	assert.ok(sources, `${name} is present`);
	return sources.join(' ');
}

test('PayPal CSP grants only the exact SDK hosts and uses the document nonce', () => {
	const policy = directives(contentSecurityPolicy('request-nonce', true, true));

	for (const name of ['connect-src', 'frame-src']) {
		for (const origin of payPalOrigins)
			assert.ok(policy.get(name)?.includes(origin), `${name} includes ${origin}`);
	}
	assert.ok(policy.get('script-src')?.includes("'nonce-request-nonce'"));
	assert.ok(policy.get('style-src')?.includes("'nonce-request-nonce'"));
	// A nonce CSP must never fall back to unsafe-inline.
	assert.doesNotMatch(sourcesOf(policy, 'script-src'), /unsafe-inline/);
	assert.doesNotMatch(sourcesOf(policy, 'style-src'), /unsafe-inline/);
	assert.ok(policy.get('frame-src')?.includes("'self'"));
	assert.doesNotMatch(sourcesOf(policy, 'connect-src'), /\*\.paypal|paypalobjects|venmo/i);
	assert.doesNotMatch(sourcesOf(policy, 'frame-src'), /\*\.paypal|paypalobjects|venmo/i);
	for (const name of ['script-src', 'style-src', 'img-src'])
		assert.doesNotMatch(sourcesOf(policy, name), /paypal|venmo/i);
	assert.equal(crossOriginOpenerPolicy(true), 'same-origin-allow-popups');
});

test('PayPal hosts and popup policy stay disabled without both public SDK keys', () => {
	const noConfig: { NEXT_PUBLIC_PAYPAL_CLIENT_ID?: string } = {};
	const partialConfig: {
		NEXT_PUBLIC_PAYPAL_CLIENT_ID: string;
		NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID?: string;
	} = { NEXT_PUBLIC_PAYPAL_CLIENT_ID: 'client-id' };
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
	const env = process.env as Record<string, string | undefined>;
	const previousNodeEnv = env.NODE_ENV;
	try {
		env.NODE_ENV = 'production';
		const policy = directives(contentSecurityPolicy('ocr-nonce', true, false));
		const scriptSrc = policy.get('script-src') ?? [];
		const connectSrc = policy.get('connect-src') ?? [];

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
		env.NODE_ENV = previousNodeEnv ?? '';
	}
});
