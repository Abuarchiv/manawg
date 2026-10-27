import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cashVoidErrorMessage } from './settlement-errors.ts';

test('a failed void names the void, not saving a settlement', () => {
	assert.equal(
		cashVoidErrorMessage('not_party_to_debt'),
		'Barzahlung konnte nicht storniert werden: Du bist an dieser Zahlung nicht beteiligt.',
	);
	assert.equal(cashVoidErrorMessage('payment_voided'), 'Diese Barzahlung ist schon storniert.');
	assert.equal(cashVoidErrorMessage('something_else'), 'Barzahlung konnte nicht storniert werden.');
});
