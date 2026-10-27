import assert from 'node:assert/strict';
import test from 'node:test';
import { withEnv } from '../../../tests/support/env';
import { requireCronSecret } from './cron-auth';

function request(authorization: string | null) {
	return new Request('https://app.example/api/cron/maintenance', {
		headers: authorization ? { authorization } : {},
	});
}

function withSecret<T>(value: string | undefined, run: () => T): T {
	return withEnv({ CRON_SECRET: value }, run);
}

test('cron routes fail closed when CRON_SECRET is not configured', () => {
	const response = withSecret(undefined, () => requireCronSecret(request('Bearer anything')));
	assert.equal(response?.status, 503);
});

test('a wrong or missing bearer token is rejected', () => {
	withSecret('s3cret', () => {
		assert.equal(requireCronSecret(request('Bearer wrong'))?.status, 401);
		assert.equal(requireCronSecret(request(null))?.status, 401);
	});
});

test('the configured bearer token is accepted', () => {
	assert.equal(
		withSecret('s3cret', () => requireCronSecret(request('Bearer s3cret'))),
		null,
	);
});
