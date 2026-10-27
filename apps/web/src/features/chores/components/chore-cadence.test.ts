import assert from 'node:assert/strict';
import test from 'node:test';

const { formatChoreCadence } = await import('./chore-cadence');

test('a matching preset supplies the label, with a non-breaking space before the unit', () => {
	assert.equal(formatChoreCadence(7, 'days'), 'wöchentlich');
	assert.equal(formatChoreCadence(14, 'days'), 'alle 14 T.');
	assert.equal(formatChoreCadence(3, 'months'), 'quartalsweise');
});

test('an interval without a preset falls back to the abbreviated unit', () => {
	assert.equal(formatChoreCadence(10, 'days'), 'alle 10 T.');
	assert.equal(formatChoreCadence(2, 'months'), 'alle 2 Mon.');
});

test('a zero interval is a one-off chore', () => {
	assert.equal(formatChoreCadence(0, 'days'), 'einmalig');
});
