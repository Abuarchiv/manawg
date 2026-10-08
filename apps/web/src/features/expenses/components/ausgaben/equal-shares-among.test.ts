import assert from 'node:assert/strict';
import test from 'node:test';
import { equalSharesAmong } from '@/features/expenses/components/ausgaben/manual-split-distribute';

test('splits evenly among the chosen people and gives leftover cents to the first ones', () => {
	assert.deepEqual(equalSharesAmong(1000, ['a', 'b']), { a: '5,00', b: '5,00' });
	assert.deepEqual(equalSharesAmong(1000, ['a', 'b', 'c']), { a: '3,34', b: '3,33', c: '3,33' });
});

test('the shares always add up to the amount', () => {
	const shares = equalSharesAmong(1001, ['a', 'b', 'c', 'd']);
	assert.ok(shares);
	const total = Object.values(shares).reduce(
		(sum, value) => sum + Math.round(Number(value.replace(',', '.')) * 100),
		0,
	);
	assert.equal(total, 1001);
});

test('nobody to split among or no positive amount gives null', () => {
	assert.equal(equalSharesAmong(1000, []), null);
	assert.equal(equalSharesAmong(0, ['a']), null);
	assert.equal(equalSharesAmong(-5, ['a']), null);
	assert.equal(equalSharesAmong(10.5, ['a']), null);
});
