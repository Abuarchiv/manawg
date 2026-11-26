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

describe('mail availability', () => {
	for (const [name, env, available] of [
		['no transport', { NODE_ENV: 'production' }, false],
		[
			'preview Resend without allowlist',
			{ NODE_ENV: 'production', VERCEL_ENV: 'preview', RESEND_API_KEY: 'key' },
			false,
		],
		[
			'preview Resend with allowlist',
			{
				NODE_ENV: 'production',
				VERCEL_ENV: 'preview',
				RESEND_API_KEY: 'key',
				STATEMENT_EMAIL_ALLOWLIST: 'a@example.test',
				STATEMENT_EMAIL_FROM: 'test@example.test',
			},
			true,
		],
		['fixture', { NODE_ENV: 'production', VERCEL_ENV: 'preview', E2E_FIXTURE_MODE: 'true' }, true],
		['SMTP without sender', { NODE_ENV: 'production', SMTP_HOST: 'smtp.example.test' }, false],
		[
			'SMTP',
			{
				NODE_ENV: 'production',
				SMTP_HOST: 'smtp.example.test',
				STATEMENT_EMAIL_FROM: 'test@example.test',
			},
			true,
		],
		[
			'official SMTP sender',
			{
				NODE_ENV: 'production',
				SMTP_HOST: 'smtp.example.test',
				NEXT_PUBLIC_APP_URL: 'https://app.manawg.com',
			},
			true,
		],
		[
			'production Resend',
			{
				NODE_ENV: 'production',
				VERCEL_ENV: 'production',
				RESEND_API_KEY: 'key',
				NEXT_PUBLIC_APP_URL: 'https://app.manawg.com',
			},
			true,
		],
	] as const) {
		test(name, async () => {
			const { mailAvailable } = await import('../src/core/mail/availability.ts');
			assert.equal(mailAvailable(env), available);
			assert.equal(
				checkEnv(env).degraded.some((entry) => entry.feature === 'email'),
				!available,
			);
		});
	}
});
