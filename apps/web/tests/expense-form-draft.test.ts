import assert from 'node:assert/strict';
import test from 'node:test';

const { parseDraftEditTarget, recurringTemplateSuggestion, splitsToManualInput } = await import(
	'../src/features/expenses/expense-form-draft.ts'
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

test('a manual booking of a fixed cost moves the extra cent like the automatic one', () => {
	const splits = [
		{ debtorMemberId: 'a', amountCents: 3334 },
		{ debtorMemberId: 'b', amountCents: 3333 },
		{ debtorMemberId: 'c', amountCents: 3333 },
	];
	const suggest = (nextDueAt: string) =>
		recurringTemplateSuggestion({
			id: 'tpl-1',
			description: 'Miete',
			amountCents: 10000,
			intervalMonths: 1,
			nextDueAt,
			paidByMemberId: 'a',
			splits,
		} as never).manualSplits;
	const january = suggest('2026-01-01T00:00:00.000Z');
	const february = suggest('2026-02-01T00:00:00.000Z');
	const extraOf = (shares: Record<string, string> | undefined) =>
		Object.entries(shares ?? {}).find(([, value]) => value === '33,34')?.[0];
	assert.ok(extraOf(january));
	assert.notEqual(extraOf(january), extraOf(february));
});
