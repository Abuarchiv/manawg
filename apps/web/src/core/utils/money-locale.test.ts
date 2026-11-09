import assert from 'node:assert/strict';
import test from 'node:test';

const { formatEuroCents } = await import('./money');

const NBSP = '\u00a0';

test('formatEuroCents defaults to German and does not change', () => {
	assert.equal(formatEuroCents(1250), `12,50${NBSP}€`);
	assert.equal(formatEuroCents(-50), `-0,50${NBSP}€`);
	assert.equal(formatEuroCents(1250, 'EUR', { signed: true }), `+12,50${NBSP}€`);
	assert.equal(formatEuroCents(1250, 'EUR', { locale: 'de' }), `12,50${NBSP}€`);
});

test('formatEuroCents formats English amounts with the pound-style layout', () => {
	assert.equal(formatEuroCents(1250, 'EUR', { locale: 'en' }), '€12.50');
	assert.equal(formatEuroCents(123456, 'EUR', { locale: 'en' }), '€1,234.56');
	assert.equal(formatEuroCents(1250, 'EUR', { locale: 'en', signed: true }), '+€12.50');
	assert.equal(formatEuroCents(-0.4, 'EUR', { locale: 'en' }), '€0.00');
});
