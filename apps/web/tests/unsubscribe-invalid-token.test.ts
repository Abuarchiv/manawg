import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

// A mangled or foreign unsubscribe link ends on a localized page, never on bare text: the link
// sits in mail footers, so people open it in a browser. GET and the one-click POST both answer 400.

mock.module('@/core/mail/unsubscribe', {
	namedExports: {
		verifyUnsubscribeToken: () => null,
		disableMailKind: async () => assert.fail('no write for an invalid token'),
		memberLocale: async () => null,
	},
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => 'ip',
		unsubscribeLimiter: {},
	},
});

const { GET, POST } = await import('../src/app/api/email/unsubscribe/route.ts');

function request(method: 'GET' | 'POST', language: string): NextRequest {
	return new NextRequest('http://localhost/api/email/unsubscribe?t=garbage', {
		method,
		headers: { 'accept-language': language },
	});
}

for (const [method, handler] of [
	['GET', GET],
	['POST', POST],
] as const) {
	test(`${method} with an invalid token answers a localized HTML page with 400`, async () => {
		const german = await handler(request(method, 'de'));
		assert.equal(german.status, 400);
		assert.match(german.headers.get('content-type') ?? '', /text\/html/);
		assert.match(await german.text(), /<h1>Link ungültig<\/h1>/);
		const english = await handler(request(method, 'en'));
		assert.equal(english.status, 400);
		assert.match(await english.text(), /<h1>Invalid link<\/h1>/);
	});
}
