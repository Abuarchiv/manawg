import assert from 'node:assert/strict';
import test from 'node:test';
import { importActionErrorMessage, recoveryActionFor } from './import-errors';

test('rate limits from middleware and routes read the same and offer a retry', () => {
	for (const code of ['rate_limited', 'too_many_requests', 'import_rate_limited']) {
		assert.match(importActionErrorMessage(code), /Zu viele Importversuche/);
		assert.equal(recoveryActionFor(code, 'commit')?.kind, 'retry_commit');
	}
});

test('each error leads to the step that can fix it', () => {
	assert.equal(recoveryActionFor('payer_unmapped', 'commit')?.kind, 'mapping');
	assert.equal(recoveryActionFor('paid_by_must_include_caller', 'commit')?.kind, 'input');
	assert.equal(recoveryActionFor('preview_hash_required', 'commit')?.kind, 'preview');
	assert.equal(recoveryActionFor('db_error', 'preview')?.kind, 'retry_preview');
	assert.equal(recoveryActionFor('something_new', 'preview'), null);
});

test('an unknown error still gets a readable fallback', () => {
	assert.match(importActionErrorMessage('something_new'), /nicht abgeschlossen/);
});
