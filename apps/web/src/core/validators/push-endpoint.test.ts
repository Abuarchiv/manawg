import { describe, expect, it } from 'vitest';

import { isAllowedPushEndpoint } from './push-endpoint';

describe('isAllowedPushEndpoint', () => {
	it('accepts the endpoints real push services hand out', () => {
		expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123')).toBe(true);
		expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc123')).toBe(
			true,
		);
		expect(isAllowedPushEndpoint('https://web.push.apple.com/QAbc123')).toBe(true);
		// Edge shards across numbered subdomains.
		expect(isAllowedPushEndpoint('https://wns2-db5p.notify.windows.com/w/?token=abc')).toBe(true);
	});

	it('rejects internal and loopback targets', () => {
		// The whole point: a stored endpoint is a server-side fetch target, so
		// these must never be persisted.
		expect(isAllowedPushEndpoint('http://169.254.169.254/latest/meta-data/')).toBe(false);
		expect(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data/')).toBe(false);
		expect(isAllowedPushEndpoint('http://localhost:8080/internal')).toBe(false);
		expect(isAllowedPushEndpoint('https://10.0.0.5/admin')).toBe(false);
		expect(isAllowedPushEndpoint('https://internal-service.svc.cluster.local/')).toBe(false);
	});

	it('rejects hosts that only look like a push service', () => {
		expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.test/fcm/send/x')).toBe(false);
		expect(isAllowedPushEndpoint('https://evil-notify.windows.com/w/')).toBe(false);
		expect(isAllowedPushEndpoint('https://notify.windows.com.attacker.test/')).toBe(false);
	});

	it('rejects a non-https scheme even on an allowed host', () => {
		expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
	});

	it('rejects a port, so an allowed hostname cannot reach another service', () => {
		expect(isAllowedPushEndpoint('https://fcm.googleapis.com:22/fcm/send/abc')).toBe(false);
	});

	it('rejects malformed input instead of throwing', () => {
		expect(isAllowedPushEndpoint('not a url')).toBe(false);
		expect(isAllowedPushEndpoint('')).toBe(false);
	});
});
