import assert from 'node:assert/strict';
import { test } from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const { recurringActionError, recurringDeleteError, recurringSaveError } = await import(
	'./recurring-errors'
);
const { SPLIT_SUM_MISMATCH } = await import('./expense-errors');

const de = serverRootT('de');
const en = serverRootT('en');

// Regression: the recurring-expense texts did not know the shared 429/503/401 answers and
// showed the generic sentence without a next step.
test('shared API answers name the next step', () => {
	assert.match(
		renderMessage(de, recurringSaveError('rate_limited', 'created')),
		/Zu viele Anfragen/,
	);
	assert.match(renderMessage(de, recurringActionError('migration_read_only')), /Wartung/);
	assert.match(renderMessage(de, recurringDeleteError('auth_required')), /Melde dich neu an/);
});

test('feature codes keep their own texts', () => {
	assert.match(renderMessage(de, recurringSaveError('not_owner', 'updated')), /Admin der WG/);
	assert.equal(
		renderMessage(de, recurringDeleteError('recurring_expense_not_found')),
		'Diese Fixkosten existieren nicht mehr. Lade die Liste neu.',
	);
	assert.equal(
		renderMessage(de, recurringSaveError('something_else', 'created')),
		'Fixkosten konnten nicht angelegt werden.',
	);
	assert.equal(
		renderMessage(de, recurringSaveError('amount_invalid', 'updated')),
		'Fixkosten konnten nicht aktualisiert werden: Prüfe den Betrag.',
	);
	assert.equal(
		renderMessage(de, recurringActionError('something_else')),
		'Fixkosten-Aktion fehlgeschlagen. Versuche es gleich erneut.',
	);
});

test('a pause that collides with another edit says the list was reloaded', () => {
	assert.match(renderMessage(de, recurringActionError('recurring_expense_changed')), /neu geladen/);
});

test('the same codes render English', () => {
	assert.equal(
		renderMessage(en, recurringSaveError('something_else', 'created')),
		'The fixed cost could not be added.',
	);
	assert.equal(
		renderMessage(en, recurringDeleteError('delete_failed')),
		'The fixed cost could not be deleted: Reload the list and check whether the entry still exists.',
	);
	assert.match(
		renderMessage(en, recurringSaveError('rate_limited', 'created')),
		/Too many requests/,
	);
});

test('the split mismatch text stays identical to the expense form text', () => {
	assert.equal(
		renderMessage(de, recurringSaveError('splits_invalid', 'created')),
		SPLIT_SUM_MISMATCH,
	);
});
