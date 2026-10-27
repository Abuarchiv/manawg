import assert from 'node:assert/strict';
import test from 'node:test';

const { buildSuggestionGroups } = await import(
	'../src/app/wg/[code]/einkauf/shopping-suggestions.ts'
);

const NOW = Date.parse('2026-10-26T12:00:00Z');
const HOUR = 60 * 60 * 1000;

const stock = (name: string, quantity: number, threshold: number, decrementCount30d = 0) =>
	({ id: name, name, quantity, threshold, decrementCount30d }) as never;

const entry = (name: string, boughtAt: string | null) =>
	({ id: name, name, boughtAt, createdAt: '2026-10-01T00:00:00Z' }) as never;

test('low stock comes first, frequent items skip names already offered or open', () => {
	const groups = buildSuggestionGroups({
		items: [entry('Reis', null)],
		inventory: [
			stock('Milch', 0, 1, 2),
			stock('Reis', 0, 1, 9),
			stock('Salz', 5, 1, 7),
			stock('Brot', 5, 1, 3),
		],
		now: NOW,
	});
	assert.deepEqual(groups, [
		{ label: 'Bald leer', names: ['Milch'] },
		{ label: 'Oft gekauft', names: ['Salz', 'Brot'] },
	]);
});

test('items bought within 24 hours are not suggested again, older ones are', () => {
	const recent = new Date(NOW - 2 * HOUR).toISOString();
	const old = new Date(NOW - 30 * HOUR).toISOString();
	const groups = buildSuggestionGroups({
		items: [entry('Milch', recent), entry('Brot', old)],
		inventory: [stock('Milch', 0, 1), stock('Brot', 0, 1)],
		now: NOW,
	});
	assert.deepEqual(groups, [{ label: 'Bald leer', names: ['Brot'] }]);
});

test('each group is capped at four names', () => {
	const inventory = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => stock(name, 0, 1));
	const [low] = buildSuggestionGroups({ items: [entry('x', null)], inventory, now: NOW });
	assert.equal(low?.names.length, 4);
});

test('an empty list falls back to staples, a filled one offers none', () => {
	const empty = buildSuggestionGroups({ items: [], inventory: [], now: NOW });
	assert.equal(empty[0]?.label, 'Vorschläge');
	assert.ok((empty[0]?.names.length ?? 0) > 0);
	assert.deepEqual(
		buildSuggestionGroups({ items: [entry('x', null)], inventory: [], now: NOW }),
		[],
	);
});
