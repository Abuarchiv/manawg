import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShoppingInput } from '../src/features/shopping/parse-shopping-input.ts';

test('English unit words stay in the quantity', () => {
	assert.deepEqual(parseShoppingInput('2 packs pasta'), { name: 'pasta', quantity: '2 packs' });
	assert.deepEqual(parseShoppingInput('3 rolls toilet paper'), {
		name: 'toilet paper',
		quantity: '3 rolls',
	});
	assert.deepEqual(parseShoppingInput('4 pcs eggs'), { name: 'eggs', quantity: '4 pcs' });
	assert.deepEqual(parseShoppingInput('2 cans beans'), { name: 'beans', quantity: '2 cans' });
	assert.deepEqual(parseShoppingInput('1.5 litres milk'), { name: 'milk', quantity: '1.5 litres' });
});

test('German unit words keep matching', () => {
	assert.deepEqual(parseShoppingInput('2 Rollen Klopapier'), {
		name: 'Klopapier',
		quantity: '2 Rollen',
	});
});
