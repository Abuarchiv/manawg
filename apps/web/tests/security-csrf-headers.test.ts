import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextRequest } from 'next/server';
import { contentSecurityPolicy } from '../src/core/infra/security-headers.ts';
import { isE2EDbDownMode } from '../src/fixtures/mode.ts';
import { config, isShareCodeLookup, originAllowed, proxy } from '../src/proxy.ts';
import { withEnv } from './support/env.ts';

// Trust-boundary contracts of the edge middleware and the security headers: CSRF origin checks,
// the password-recovery matcher, the share-code lookup bucket, CSP and the fixture guard.

describe('csrf origin', () => {
	const WRITE_URL = 'https://app.example.com/api/wg/ABCDEFGH/expenses';

	function request(headers: Record<string, string>, method = 'POST'): NextRequest {
		return new NextRequest(WRITE_URL, { method, headers });
	}

	test('allows same-origin writes and browser-less reads', () => {
		assert.equal(
			originAllowed(request({ host: 'app.example.com', origin: 'https://app.example.com' })),
			true,
		);
		assert.equal(
			originAllowed(request({ host: 'app.example.com', origin: 'https://app.example.com/' })),
			true,
		);
		assert.equal(originAllowed(request({ host: 'app.example.com' }, 'GET')), true);
		assert.equal(originAllowed(request({ host: 'app.example.com' }, 'HEAD')), true);
		assert.equal(originAllowed(request({ host: 'app.example.com' }, 'OPTIONS')), true);
	});

	test('fails closed for a write without an Origin header', () => {
		assert.equal(originAllowed(request({ host: 'app.example.com' })), false);
	});

	test('rejects cross-origin writes including takeover lookalikes', async () => {
		const rejected = [
			'https://evil.example.com',
			'https://app.example.com.evil.test',
			// A taken-over subdomain must not inherit the parent origin's trust.
			'https://takeover.app.example.com',
			// userinfo@host parsing: the real host is evil.test.
			'https://app.example.com@evil.test',
			// Port and protocol must match the request.
			'https://app.example.com:8443',
			'http://app.example.com',
			// Sandboxed iframes and non-http contexts send "null" or no usable URL.
			'null',
			'not-a-url',
		];

		for (const origin of rejected) {
			const req = request({ host: 'app.example.com', origin });
			assert.equal(originAllowed(req), false, origin);
			assert.equal((await proxy(req)).status, 403, origin);
		}
	});

	test('rejects a write when the Host header is missing', () => {
		assert.equal(originAllowed(request({ origin: 'https://app.example.com' })), false);
	});

	test('treats an explicit default port as same-origin and still rejects others', () => {
		// Browsers normalize https://host:443 to https://host, so this IS same-origin.
		assert.equal(
			originAllowed(request({ host: 'app.example.com', origin: 'https://app.example.com:443' })),
			true,
		);
		assert.equal(
			originAllowed(
				request({ host: 'app.example.com:3000', origin: 'https://app.example.com:3000' }),
			),
			true,
		);
		assert.equal(
			originAllowed(request({ host: 'app.example.com', origin: 'https://app.example.com:3000' })),
			false,
		);
	});

	test('guards the password-recovery API like every other state-changing route', async () => {
		assert.ok(config.matcher.includes('/api/auth/:path*'));
		const req = new NextRequest('https://app.example.com/api/auth/recovery', {
			method: 'DELETE',
			headers: { host: 'app.example.com', origin: 'https://evil.example.com' },
		});
		assert.equal((await proxy(req)).status, 403);
	});
});

describe('security headers', () => {
	test('CSP keeps upgrade-insecure-requests by default', () => {
		const nonce = 'security-headers-test-nonce';
		const policy = contentSecurityPolicy(nonce);

		assert.match(policy, /upgrade-insecure-requests/);
		assert.ok(policy.includes(`'nonce-${nonce}'`));
	});

	test('fixture CSP opt-out removes only upgrade-insecure-requests', () => {
		const nonce = 'security-headers-test-nonce';
		const defaultPolicy = contentSecurityPolicy(nonce);
		const fixturePolicy = contentSecurityPolicy(nonce, false);

		assert.equal(fixturePolicy, defaultPolicy.replace(/; upgrade-insecure-requests$/, ''));
	});

	test('fixture guard allows Preview but rejects Production', () => {
		withEnv(
			{
				E2E_FIXTURE_MODE: 'true',
				VERCEL_ENV: 'preview',
				NEXT_PUBLIC_DB_DOWN: 'true',
				CI: 'true',
				POSTGRES_URL: '',
				DATABASE_URL: '',
			},
			() => {
				assert.equal(isE2EDbDownMode(), true);

				process.env.VERCEL_ENV = 'production';
				assert.equal(isE2EDbDownMode(), false);
			},
		);
	});
});

describe('require wg member regression', () => {
	test('keeps account membership out of the share-code rate-limit bucket', () => {
		assert.equal(isShareCodeLookup('/api/wg/mine', 'GET'), false);
		assert.equal(isShareCodeLookup('/api/wg/ABCDEFGH', 'GET'), true);
		assert.equal(isShareCodeLookup('/api/wg/INVALID', 'GET'), true);
		assert.equal(isShareCodeLookup('/api/wg/ABCDEFGH', 'POST'), false);
	});
});

describe('malformed percent-encoding in the path', () => {
	test('answers an API path with 400 and a JSON error', async () => {
		const res = await proxy(new NextRequest('http://localhost/api/wg/%E0%A4%A'));
		assert.equal(res.status, 400);
		assert.deepEqual(await res.json(), { error: 'bad_request' });
	});

	test('answers a page path with 400', async () => {
		const res = await proxy(new NextRequest('http://localhost/wg/%E0%A4%A'));
		assert.equal(res.status, 400);
	});

	test('lets a well-formed page path through', async () => {
		const res = await proxy(new NextRequest('http://localhost/wg/SMKETEST'));
		assert.notEqual(res.status, 400);
	});
});
