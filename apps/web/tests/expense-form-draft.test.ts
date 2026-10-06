import assert from 'node:assert/strict';
import test from 'node:test';

const { parseDraftEditTarget, recurringTemplateSuggestion, splitsToManualInput } = await import(
	'../src/features/expenses/components/ausgaben/expense-form-draft.ts'
);

test('a draft without an edit target creates a new expense', () => {
	assert.deepEqual(parseDraftEditTarget(undefined), { kind: 'none' });
	assert.deepEqual(parseDraftEditTarget(null), { kind: 'none' });
});

test('a draft edit target needs a safe id and a parseable version', () => {
	const updatedAt = '2026-10-01T10:00:00.000Z';
	assert.deepEqual(parseDraftEditTarget({ id: 'exp-1', updatedAt, currency: 'EUR' }), {
		kind: 'valid',
		reference: { id: 'exp-1', updatedAt, currency: 'EUR' },
	});
	assert.deepEqual(parseDraftEditTarget({ id: 'exp-1', updatedAt, currency: 'nope' }), {
		kind: 'valid',
		reference: { id: 'exp-1', updatedAt },
	});
	for (const damaged of [
		{ invalid: true },
		{ id: '../x', updatedAt },
		{ id: 'exp-1', updatedAt: 'gestern' },
		'exp-1',
	]) {
		assert.deepEqual(parseDraftEditTarget(damaged), { kind: 'invalid' });
	}
});

test('a due template becomes a manual-split expense suggestion', () => {
	const splits = [
		{ debtorMemberId: 'a', amountCents: 1250 },
		{ debtorMemberId: 'b', amountCents: 1249 },
	];
	assert.deepEqual(splitsToManualInput(splits), { a: '12,50', b: '12,49' });
	const suggestion = recurringTemplateSuggestion({
		id: 'tpl-1',
		description: 'Internet',
		amountCents: 2499,
		paidByMemberId: 'a',
		splits,
	} as never);
	assert.equal(suggestion.recurringSourceId, 'tpl-1');
	assert.equal(suggestion.splitMode, 'manual');
	assert.equal(suggestion.amountStr, '24,99');
	assert.equal(suggestion.imageUrl, null);
	assert.deepEqual(suggestion.manualSplits, { a: '12,50', b: '12,49' });
});
