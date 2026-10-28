import assert from 'node:assert/strict';
import test from 'node:test';

const { importActionErrorMessage, recoveryActionFor } = await import('./import-errors');

test('shared error buckets get the import wording', () => {
	assert.equal(importActionErrorMessage('Netzwerkfehler').key, 'common.errors.network');
	assert.equal(
		importActionErrorMessage('wg_not_found').key,
		'expenses-import.errors.wgUnavailable',
	);
	assert.equal(
		importActionErrorMessage('not_a_member').key,
		'expenses-import.errors.authInvalidated',
	);
	assert.equal(importActionErrorMessage('db_error').key, 'expenses-import.errors.retryLater');
	assert.equal(
		importActionErrorMessage('rate_limiter_unavailable').key,
		'expenses-import.errors.retryLater',
	);
});

test('every rate-limit spelling gets the import-specific copy', () => {
	for (const code of ['too_many_requests', 'rate_limited', 'import_rate_limited']) {
		assert.equal(importActionErrorMessage(code).key, 'expenses-import.errors.rateLimited', code);
	}
});

test('import-only codes keep their own copy and unknown codes fall back', () => {
	assert.equal(
		importActionErrorMessage('mapping_incomplete').key,
		'expenses-import.errors.mappingIncomplete',
	);
	assert.equal(importActionErrorMessage('something_new').key, 'expenses-import.errors.fallback');
});

test('recovery actions follow the error kind', () => {
	assert.equal(recoveryActionFor('payer_unmapped', 'commit')?.kind, 'mapping');
	assert.equal(recoveryActionFor('db_error', 'preview')?.kind, 'retry_preview');
	assert.equal(recoveryActionFor('db_error', 'commit')?.kind, 'retry_commit');
	assert.equal(recoveryActionFor('something_new', 'commit'), null);
});
