import assert from 'node:assert/strict';
import { test } from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const { aboActionError, aboDeleteError, aboSaveError } = await import('./recurring-errors');
const { SPLIT_SUM_MISMATCH } = await import('./expense-errors');

const de = serverRootT('de');
const en = serverRootT('en');

// Regression: the recurring-expense texts did not know the shared 429/503/401 answers and
// showed the generic sentence without a next step.
test('shared API answers name the next step', () => {
	assert.match(renderMessage(de, aboSaveError('rate_limited', 'created')), /Zu viele Anfragen/);
	assert.match(renderMessage(de, aboActionError('migration_read_only')), /Wartung/);
	assert.match(renderMessage(de, aboDeleteError('auth_required')), /Melde dich neu an/);
});

test('feature codes keep their own texts', () => {
	assert.match(renderMessage(de, aboSaveError('not_owner', 'updated')), /Admin der WG/);
	assert.equal(
		renderMessage(de, aboDeleteError('recurring_expense_not_found')),
		'Diese Fixkosten existieren nicht mehr. Lade die Liste neu.',
	);
	assert.equal(
		renderMessage(de, aboSaveError('something_else', 'created')),
		'Fixkosten konnten nicht angelegt werden.',
	);
	assert.equal(
		renderMessage(de, aboSaveError('amount_invalid', 'updated')),
		'Fixkosten konnten nicht aktualisiert werden: Prüfe den Betrag.',
	);
	assert.equal(
		renderMessage(de, aboActionError('something_else')),
		'Fixkosten-Aktion fehlgeschlagen. Versuche es gleich erneut.',
	);
});

test('a pause that collides with another edit says the list was reloaded', () => {
	assert.match(renderMessage(de, aboActionError('recurring_expense_changed')), /neu geladen/);
});

test('the same codes render English', () => {
	assert.equal(
		renderMessage(en, aboSaveError('something_else', 'created')),
		'The fixed cost could not be added.',
	);
	assert.equal(
		renderMessage(en, aboDeleteError('delete_failed')),
		'The fixed cost could not be deleted: Reload the list and check whether the entry still exists.',
	);
	assert.match(renderMessage(en, aboSaveError('rate_limited', 'created')), /Too many requests/);
});

test('the split mismatch text stays identical to the expense form text', () => {
	assert.equal(renderMessage(de, aboSaveError('splits_invalid', 'created')), SPLIT_SUM_MISMATCH);
});
