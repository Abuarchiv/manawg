import assert from 'node:assert/strict';
import test from 'node:test';

const { formatEuroCents } = await import('./money');

const NBSP = ' ';

test('formatEuroCents never renders a negative zero for sub-cent amounts', () => {
	assert.equal(formatEuroCents(-0.4), `0,00${NBSP}€`);
	assert.equal(formatEuroCents(-0.4, 'EUR', { locale: 'en' }), '€0.00');
});
