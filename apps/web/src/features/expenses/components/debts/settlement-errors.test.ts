import assert from 'node:assert/strict';
import { test } from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const { cashVoidError, settlementError } = await import('./settlement-errors');

const de = serverRootT('de');
const en = serverRootT('en');

test('a failed void names the void, not saving a settlement', () => {
	assert.equal(
		renderMessage(de, cashVoidError('not_party_to_debt')),
		'Barzahlung konnte nicht storniert werden: Du bist an dieser Zahlung nicht beteiligt.',
	);
	assert.equal(
		renderMessage(de, cashVoidError('payment_voided')),
		'Diese Barzahlung ist schon storniert.',
	);
	assert.equal(
		renderMessage(de, cashVoidError('something_else')),
		'Barzahlung konnte nicht storniert werden.',
	);
});

test('settlement codes keep their German texts', () => {
	assert.equal(
		renderMessage(de, settlementError('amount_invalid')),
		'Barzahlung konnte nicht gespeichert werden: Der Betrag ist ungültig.',
	);
	assert.equal(
		renderMessage(de, settlementError('same_member')),
		'Ausgleich konnte nicht gespeichert werden: Die Anfrage war ungültig.',
	);
	assert.equal(
		renderMessage(de, settlementError('rate_limited')),
		'Ausgleich konnte nicht gespeichert werden: Zu viele Anfragen. Warte kurz und versuche es dann erneut.',
	);
});

test('the same codes render English', () => {
	assert.equal(
		renderMessage(en, cashVoidError('not_party_to_debt')),
		'The cash payment could not be reversed: You are not involved in this payment.',
	);
	assert.equal(
		renderMessage(en, settlementError('something_else')),
		'The settlement could not be saved.',
	);
});
