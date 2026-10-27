import assert from 'node:assert/strict';
import test from 'node:test';

const { importActionErrorMessage, recoveryActionFor } = await import('./import-errors');

test('shared error buckets get the import wording', () => {
	assert.match(importActionErrorMessage('Netzwerkfehler'), /Verbindung/);
	assert.match(importActionErrorMessage('wg_not_found'), /WG wurde nicht gefunden/);
	assert.match(importActionErrorMessage('not_a_member'), /Tritt der WG erneut bei/);
	assert.match(importActionErrorMessage('db_error'), /gleich erneut/);
	assert.match(importActionErrorMessage('rate_limiter_unavailable'), /gleich erneut/);
});

test('every rate-limit spelling gets the import-specific copy', () => {
	for (const code of ['too_many_requests', 'rate_limited', 'import_rate_limited']) {
		assert.match(importActionErrorMessage(code), /Zu viele Importversuche/, code);
	}
});

test('import-only codes keep their own copy and unknown codes fall back', () => {
	assert.match(importActionErrorMessage('mapping_incomplete'), /WG-Mitglied/);
	assert.match(importActionErrorMessage('something_new'), /nicht abgeschlossen/);
});

test('recovery actions follow the error kind', () => {
	assert.equal(recoveryActionFor('payer_unmapped', 'commit')?.kind, 'mapping');
	assert.equal(recoveryActionFor('db_error', 'preview')?.kind, 'retry_preview');
	assert.equal(recoveryActionFor('db_error', 'commit')?.kind, 'retry_commit');
	assert.equal(recoveryActionFor('something_new', 'commit'), null);
});
