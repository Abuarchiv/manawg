import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aboActionErrorMessage, aboDeleteErrorMessage, aboSaveErrorMessage } from './abo-errors';

// Regression: the recurring-expense texts did not know the shared 429/503/401 answers and
// showed the generic sentence without a next step.
test('shared API answers name the next step', () => {
	assert.match(aboSaveErrorMessage('rate_limited', 'angelegt'), /Zu viele Anfragen/);
	assert.match(aboActionErrorMessage('migration_read_only'), /Wartung/);
	assert.match(aboDeleteErrorMessage('auth_required'), /Melde dich neu an/);
});

test('feature codes keep their own texts', () => {
	assert.match(aboSaveErrorMessage('not_owner', 'aktualisiert'), /Admin der WG/);
	assert.equal(
		aboDeleteErrorMessage('recurring_expense_not_found'),
		'Diese Fixkosten existieren nicht mehr. Lade die Liste neu.',
	);
	assert.equal(
		aboSaveErrorMessage('something_else', 'angelegt'),
		'Fixkosten konnten nicht angelegt werden.',
	);
});
