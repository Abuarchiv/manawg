import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy } from '../src/core/infra/security-headers.ts';
import { withEnv } from './support/env.ts';

const ocrLanguageDataUrls = [
	'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz',
	'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
];

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

test('Tesseract gets WASM compilation and only its pinned German and English data files', () => {
	withEnv({ NODE_ENV: 'production' }, () => {
		const policy = directives(contentSecurityPolicy('ocr-nonce'));
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
	});
});

test('the policy names no S3 or other third-party storage host', () => {
	const policy = contentSecurityPolicy('nonce');
	assert.doesNotMatch(policy, /amazonaws/);
	const parsed = directives(policy);
	assert.deepEqual(parsed.get('img-src'), ["'self'", 'data:', 'blob:']);
	assert.deepEqual(parsed.get('media-src'), ["'self'", 'blob:']);
});
