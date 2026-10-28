import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy } from '../src/core/infra/security-headers.ts';
import { withEnv } from './support/env.ts';

function directives(policy: string): Map<string, string[]> {
	return new Map(
		policy.split(';').map((entry): [string, string[]] => {
			const [name = '', ...sources] = entry.trim().split(/\s+/);
			return [name, sources];
		}),
	);
}

test('CSP uses the document nonce and never falls back to unsafe-inline', () => {
	const policy = directives(contentSecurityPolicy('request-nonce'));

	assert.ok(policy.get('script-src')?.includes("'nonce-request-nonce'"));
	assert.ok(policy.get('style-src')?.includes("'nonce-request-nonce'"));
	assert.doesNotMatch((policy.get('script-src') ?? []).join(' '), /unsafe-inline/);
	assert.doesNotMatch((policy.get('style-src') ?? []).join(' '), /unsafe-inline/);
});

test('Tesseract gets WASM compilation and loads everything from the app origin', () => {
	const noProviders = {
		NODE_ENV: 'production',
		NEXT_PUBLIC_POSTHOG_HOST: undefined,
		NEXT_PUBLIC_SUPABASE_URL: undefined,
		NEXT_PUBLIC_SENTRY_DSN: undefined,
	};
	withEnv(noProviders, () => {
		const policy = contentSecurityPolicy('ocr-nonce');
		const parsed = directives(policy);
		const scriptSrc = parsed.get('script-src') ?? [];

		assert.ok(scriptSrc.includes("'wasm-unsafe-eval'"));
		assert.ok(!scriptSrc.includes("'unsafe-eval'"));
		assert.doesNotMatch(policy, /jsdelivr/);
		assert.deepEqual(parsed.get('worker-src'), ["'self'", 'blob:']);
		assert.deepEqual(parsed.get('connect-src'), ["'self'"]);
	});
});

test('the policy names no S3 or other third-party storage host', () => {
	const policy = contentSecurityPolicy('nonce');
	assert.doesNotMatch(policy, /amazonaws/);
	const parsed = directives(policy);
	assert.deepEqual(parsed.get('img-src'), ["'self'", 'data:', 'blob:']);
	assert.deepEqual(parsed.get('media-src'), ["'self'", 'blob:']);
});
