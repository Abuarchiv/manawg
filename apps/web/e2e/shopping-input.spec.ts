import { expect, test } from '@playwright/test';
import { parseShoppingInput } from '../src/features/shopping/parse-shopping-input';

test('splits a leading amount from the item name', () => {
	expect(parseShoppingInput('2 Hafermilch')).toEqual({ name: 'Hafermilch', quantity: '2' });
	expect(parseShoppingInput(' 1,5 L  Milch ')).toEqual({ name: 'Milch', quantity: '1,5 L' });
	expect(parseShoppingInput('3x Brot')).toEqual({ name: 'Brot', quantity: '3x' });
	expect(parseShoppingInput('1 Packung Kaffee')).toEqual({ name: 'Kaffee', quantity: '1 Packung' });
	expect(parseShoppingInput('7Up')).toEqual({ name: '7Up', quantity: null });
	expect(parseShoppingInput('Milch')).toEqual({ name: 'Milch', quantity: null });
	expect(parseShoppingInput('2')).toEqual({ name: '2', quantity: null });
});
