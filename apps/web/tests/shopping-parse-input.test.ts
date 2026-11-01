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

test('further English and German unit words stay in the quantity', () => {
	assert.deepEqual(parseShoppingInput('2 liters milk'), { name: 'milk', quantity: '2 liters' });
	assert.deepEqual(parseShoppingInput('2 lb flour'), { name: 'flour', quantity: '2 lb' });
	assert.deepEqual(parseShoppingInput('3 bags rice'), { name: 'rice', quantity: '3 bags' });
	assert.deepEqual(parseShoppingInput('2 Gläser Gurken'), {
		name: 'Gurken',
		quantity: '2 Gläser',
	});
	assert.deepEqual(parseShoppingInput('1 Bund Radieschen'), {
		name: 'Radieschen',
		quantity: '1 Bund',
	});
});

test('an English "of" after the unit is not part of the name', () => {
	assert.deepEqual(parseShoppingInput('2 packs of oat milk'), {
		name: 'oat milk',
		quantity: '2 packs',
	});
	assert.deepEqual(parseShoppingInput('1 kg of flour'), { name: 'flour', quantity: '1 kg' });
	assert.deepEqual(parseShoppingInput('500 g of butter'), { name: 'butter', quantity: '500 g' });
	assert.deepEqual(parseShoppingInput('2 packs pasta'), { name: 'pasta', quantity: '2 packs' });
	assert.deepEqual(parseShoppingInput('2 Packungen Hafermilch'), {
		name: 'Hafermilch',
		quantity: '2 Packungen',
	});
	assert.deepEqual(parseShoppingInput('7Up'), { name: '7Up', quantity: null });
	assert.deepEqual(parseShoppingInput('2 of'), { name: 'of', quantity: '2' });
});
