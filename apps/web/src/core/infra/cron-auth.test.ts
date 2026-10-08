import assert from 'node:assert/strict';
import test from 'node:test';
import { requireCronSecret } from './cron-auth';

function request(authorization: string | null) {
	return new Request('https://app.example/api/cron/maintenance', {
		headers: authorization ? { authorization } : {},
	});
}

function withSecret<T>(value: string | undefined, run: () => T): T {
	const previous = process.env.CRON_SECRET;
	if (value === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
	else process.env.CRON_SECRET = value;
	try {
		return run();
	} finally {
		if (previous === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
		else process.env.CRON_SECRET = previous;
	}
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
