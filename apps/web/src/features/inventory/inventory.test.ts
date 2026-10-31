import assert from 'node:assert/strict';
import test from 'node:test';
import {
	boughtRestockMatches,
	clampQuantity,
	decimalQuantityText,
	parseQuantityText,
	quantityInputText,
	quickRestockCandidates,
	restockAmount,
} from './inventory';

const stock = (name: string, quantity: number, threshold: number, decrementCount30d = 0) => ({
	name,
	quantity,
	threshold,
	decrementCount30d,
});

test('restockAmount lifts a scarce item above its threshold, otherwise adds one', () => {
	assert.equal(restockAmount(stock('Klopapier', 0, 2)), 3);
	assert.equal(restockAmount(stock('Salz', 5, 2)), 1);
});

test('quick restock lists scarce items first and skips idle full ones', () => {
	const result = quickRestockCandidates([
		stock('Reis', 5, 1, 4),
		stock('Salz', 5, 1, 0),
		stock('Seife', 1, 2),
		stock('Klopapier', 0, 2),
	]);
	assert.deepEqual(
		result.map((item) => item.name),
		['Klopapier', 'Seife', 'Reis'],
	);
});

test('the latest matching purchase stays attached to each scarce item', () => {
	const items = [stock('Klopapier', 0, 2), stock('Salz', 5, 1)];
	const first = { id: 'first', name: 'Klopapier', boughtAt: '2026-10-30T12:00:00Z' };
	const latest = { id: 'second', name: ' klopapier ', boughtAt: '2026-10-31T12:00:00Z' };
	assert.deepEqual(boughtRestockMatches(items, [latest, first, { ...latest, name: 'Salz' }]), [
		{ item: items[0], purchase: latest },
	]);
});

test('decimalQuantityText keeps German decimals up to two places', () => {
	assert.equal(decimalQuantityText('1,5'), '1,5');
	assert.equal(decimalQuantityText('1.5'), '1,5');
	assert.equal(decimalQuantityText('1,555'), '1,55');
	assert.equal(decimalQuantityText('1,5,5'), '1,55');
	assert.equal(decimalQuantityText('12 Stk'), '12');
	assert.equal(decimalQuantityText('1,'), '1,');
	assert.equal(decimalQuantityText(''), '');
});

test('decimalQuantityText stops at four whole digits, the quantity and threshold maximum', () => {
	assert.equal(decimalQuantityText('15000'), '1500');
	assert.equal(decimalQuantityText('9999'), '9999');
	assert.equal(decimalQuantityText('12345,5'), '1234,5');
	assert.equal(decimalQuantityText('12345.5', 'en'), '1234.5');
});

test('parseQuantityText and quantityInputText round-trip German decimals', () => {
	assert.equal(parseQuantityText('1,5'), 1.5);
	assert.equal(parseQuantityText(''), 0);
	assert.equal(parseQuantityText('1,'), 1);
	assert.equal(quantityInputText(1.5), '1,5');
	assert.equal(clampQuantity(2.3 - 1), 1.3);
});

test('restockAmount stays exact for decimal stock', () => {
	assert.equal(restockAmount({ quantity: 0.7, threshold: 2 }), 2.3);
	assert.equal(restockAmount({ quantity: 0.5, threshold: 1 }), 1.5);
	assert.equal(restockAmount({ quantity: 1, threshold: 3 }), 3);
});
