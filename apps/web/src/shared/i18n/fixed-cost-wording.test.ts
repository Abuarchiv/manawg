import assert from 'node:assert/strict';
import test from 'node:test';

const { default: offlineFailure } = await import('./messages/en/offline-failure');
const { default: expensesForm } = await import('./messages/en/expenses-form');

type Tree = { [key: string]: string | Tree };

// Collects the string values stored under `key` anywhere in the tree.
function valuesOf(tree: Tree, key: string): string[] {
	return Object.entries(tree).flatMap(([name, value]) => {
		if (typeof value === 'string') return name === key ? [value] : [];
		return valuesOf(value, key);
	});
}

const FIXED_COST_MESSAGES: ReadonlyArray<readonly [string, string]> = [
	['offline templateChanged.detail', (offlineFailure.templateChanged as Tree).detail as string],
	['offline recurringAdvanced.title', (offlineFailure.recurringAdvanced as Tree).title as string],
	['offline recurringAdvanced.detail', (offlineFailure.recurringAdvanced as Tree).detail as string],
	...valuesOf(expensesForm as unknown as Tree, 'recurringChanged').map(
		(message) => ['form recurringChanged', message] as const,
	),
];

// The fixed-cost action is called "Record" in English, so the messages around it use "record".
for (const [label, message] of FIXED_COST_MESSAGES) {
	test(`${label} says "record", not "book"`, () => {
		assert.doesNotMatch(message, /\bbook(ed|ing|s)?\b/i);
		assert.match(message, /\brecord(ed)?\b/i);
	});
}

test('the form recurringChanged message exists', () => {
	assert.equal(valuesOf(expensesForm as unknown as Tree, 'recurringChanged').length, 1);
});
