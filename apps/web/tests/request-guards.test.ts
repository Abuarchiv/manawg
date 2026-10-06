// Request guards at the trust boundary: CSRF origin checks, security headers, the fixture-mode
// guard, share-code lookup classification and legacy claim proofs.

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path, { join } from 'node:path';
import { describe, test } from 'node:test';
import { NextRequest } from 'next/server';
import { verifyLegacyClaimProof } from '../src/core/guards/legacy-claim-proof';
import { contentSecurityPolicy } from '../src/core/infra/security-headers';
import { isE2EDbDownMode } from '../src/fixtures/mode';
import { config, isShareCodeLookup, middleware, originAllowed } from '../src/middleware';

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
			assert.equal((await middleware(req)).status, 403, origin);
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
		assert.equal((await middleware(req)).status, 403);
	});
});

describe('security headers', () => {
	test('CSP keeps upgrade-insecure-requests by default', () => {
		const nonce = 'security-headers-test-nonce';
		const policy = contentSecurityPolicy(nonce);

		assert.ok(policy.includes('upgrade-insecure-requests'));
		assert.ok(policy.includes(`'nonce-${nonce}'`));
	});

	test('fixture CSP opt-out removes only upgrade-insecure-requests', () => {
		const nonce = 'security-headers-test-nonce';
		const defaultPolicy = contentSecurityPolicy(nonce);
		const fixturePolicy = contentSecurityPolicy(nonce, false);

		assert.equal(fixturePolicy, defaultPolicy.replace(/; upgrade-insecure-requests$/, ''));
	});

	test('fixture guard allows Preview but rejects Production', () => {
		const keys = [
			'E2E_FIXTURE_MODE',
			'VERCEL_ENV',
			'NEXT_PUBLIC_DB_DOWN',
			'CI',
			'POSTGRES_URL',
			'DATABASE_URL',
		] as const;
		const saved = new Map(keys.map((key) => [key, process.env[key]]));

		try {
			process.env.E2E_FIXTURE_MODE = 'true';
			process.env.VERCEL_ENV = 'preview';
			process.env.NEXT_PUBLIC_DB_DOWN = 'true';
			process.env.CI = 'true';
			process.env.POSTGRES_URL = '';
			process.env.DATABASE_URL = '';
			assert.equal(isE2EDbDownMode(), true);

			process.env.VERCEL_ENV = 'production';
			assert.equal(isE2EDbDownMode(), false);
		} finally {
			for (const key of keys) {
				const value = saved.get(key);
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
});

describe('require wg member regression', () => {
	test('keeps account membership out of the share-code rate-limit bucket', () => {
		assert.equal(isShareCodeLookup('/api/wg/mine', 'GET'), false);
		assert.equal(isShareCodeLookup('/api/wg/ABCDEFGH', 'GET'), true);
		assert.equal(isShareCodeLookup('/api/wg/INVALID', 'GET'), true);
		assert.equal(isShareCodeLookup('/api/wg/ABCDEFGH', 'POST'), false);
	});

	test('WG root verifies identity before looking up a live share code', () => {
		const source = readFileSync(
			join(import.meta.dirname, '../src/app/api/wg/[code]/route.ts'),
			'utf8',
		);
		const getHandler = source
			.split('export async function GET(')[1]
			?.split('export async function PATCH(')[0];
		if (!getHandler) throw new Error('GET handler not found');
		// requireWgMembership authenticates the Supabase user before it runs the WG lookup.
		assert.ok(
			getHandler.indexOf('readShareCode(ctx)') <
				getHandler.indexOf('requireWgMembership(req, code'),
		);
		const guard = readFileSync(
			join(import.meta.dirname, '../src/core/guards/require-wg-member.ts'),
			'utf8',
		);
		assert.ok(guard.indexOf('getAuthenticatedUser(req)') < guard.indexOf('loadWg(code)'));
		assert.ok(guard.indexOf('loadWg(code)') < guard.indexOf('requireMember(req, wg.id, user)'));
	});
});

describe('legacy claim proof', () => {
	const wgId = '989ac820-58b7-431f-9c65-28721264f333';
	const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

	test('legacy claim proof accepts the stored HMAC and rejects trailing data or a missing secret', () => {
		const previousSecret = process.env.MEMBER_SESSION_SECRET;
		process.env.MEMBER_SESSION_SECRET = 'auth-regression-secret';
		try {
			const token = createHmac('sha256', 'auth-regression-secret')
				.update(`${wgId}:${memberId}`)
				.digest('hex');
			assert.equal(verifyLegacyClaimProof(wgId, memberId, token), true);
			assert.equal(verifyLegacyClaimProof(wgId, memberId, `${token}g`), false);
			assert.equal(verifyLegacyClaimProof(wgId, memberId, null), false);
			Reflect.deleteProperty(process.env, 'MEMBER_SESSION_SECRET');
			assert.equal(verifyLegacyClaimProof(wgId, memberId, token), false);
		} finally {
			if (previousSecret === undefined)
				Reflect.deleteProperty(process.env, 'MEMBER_SESSION_SECRET');
			else process.env.MEMBER_SESSION_SECRET = previousSecret;
		}
	});

	test('normal server membership derives identity from auth alone, without member tokens', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/core/guards/api-auth.ts'),
			'utf8',
		);
		assert.ok(source.includes('eq(wgMembers.authUserId, user.id)'));
		assert.ok(!source.includes('legacy-claim-proof'));
		assert.ok(!source.includes('LEGACY_CLAIM'));
	});
});
