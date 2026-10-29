import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { checkEnv, runtimeEnv } from '../src/core/infra/env.ts';

// The health report and boot log read the public VAPID key and Sentry DSN through runtimeEnv, so a
// build-time value counts as configured even when the container environment lacks it.

const KEYS = [
	'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
	'NEXT_PUBLIC_SENTRY_DSN',
	'VAPID_PRIVATE_KEY',
	'VAPID_SUBJECT',
] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
	for (const key of KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
});

describe('runtimeEnv', () => {
	test('reports push and error reporting as configured when the public values are present', () => {
		process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'public-key';
		process.env.VAPID_PRIVATE_KEY = 'private-key';
		process.env.VAPID_SUBJECT = 'mailto:ops@example.com';
		process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://key@sentry.example.com/1';
		const features = checkEnv(runtimeEnv()).degraded.map((entry) => entry.feature);
		assert.equal(features.includes('push-notifications'), false);
		assert.equal(features.includes('error-reporting'), false);
	});

	test('reports them as degraded when the public values are empty', () => {
		process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = '';
		process.env.NEXT_PUBLIC_SENTRY_DSN = '';
		const features = checkEnv(runtimeEnv()).degraded.map((entry) => entry.feature);
		assert.ok(features.includes('push-notifications'));
		assert.ok(features.includes('error-reporting'));
	});
});
