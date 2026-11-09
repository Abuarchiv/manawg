import assert from 'node:assert/strict';
import test from 'node:test';

const { INVALID_RESPONSE_CODE, NETWORK_ERROR_CODE, mutationError } = await import('./error-codes');

const SUBJECT = { key: 'common.loadError.lead.expenses' } as const;
const FALLBACK = { key: 'common.errors.signInAgain' } as const;
const SPECIFIC_CODE = 'import_settled';

const CODES = [
	NETWORK_ERROR_CODE,
	'Failed to fetch',
	'too_many_requests',
	'server_error',
	'x_rate_limited',
	'migration_read_only',
	'auth_required',
	'unexpected_error',
	'db_error',
	'wg_not_found',
	'invalid_share_code',
	'not_a_member',
	SPECIFIC_CODE,
	'something_else',
	INVALID_RESPONSE_CODE,
];

test('mutationError maps every bucket to its detail', () => {
	const specific = { [SPECIFIC_CODE]: { key: 'common.errors.queryTooLong' } } as const;
	const detail = (code: string) => mutationError(SUBJECT, code, specific, FALLBACK);
	const withSubject = (key: string) => ({
		key: 'common.errors.withSubject',
		values: { subject: SUBJECT, detail: { key } },
	});
	assert.deepEqual(detail(NETWORK_ERROR_CODE), withSubject('common.errors.network'));
	assert.deepEqual(detail('server_error'), withSubject('common.errors.retry'));
	assert.deepEqual(detail('too_many_requests'), withSubject('common.errors.rateLimited'));
	assert.deepEqual(detail('migration_read_only'), withSubject('common.errors.readOnly'));
	assert.deepEqual(detail('auth_required'), withSubject('common.errors.sessionExpired'));
	assert.deepEqual(detail('wg_not_found'), withSubject('common.errors.wgUnavailable'));
	assert.deepEqual(detail('invalid_share_code'), withSubject('common.errors.invalidShareCode'));
	assert.deepEqual(detail('not_a_member'), withSubject('common.errors.authInvalidated'));
	assert.deepEqual(detail(SPECIFIC_CODE), specific[SPECIFIC_CODE]);
	assert.deepEqual(detail('something_else'), FALLBACK);
	assert.deepEqual(detail(INVALID_RESPONSE_CODE), FALLBACK);
	for (const code of CODES) assert.ok(detail(code).key.length > 0, code);
});

test('mutationError uses the retry subject only for the retryable bucket', () => {
	const retrySubject = { key: 'common.loading' } as const;
	assert.deepEqual(mutationError(SUBJECT, 'db_error', {}, FALLBACK, retrySubject), {
		key: 'common.errors.withSubject',
		values: { subject: retrySubject, detail: { key: 'common.errors.retry' } },
	});
	assert.deepEqual(mutationError(SUBJECT, 'too_many_requests', {}, FALLBACK, retrySubject), {
		key: 'common.errors.withSubject',
		values: { subject: SUBJECT, detail: { key: 'common.errors.rateLimited' } },
	});
});
