import assert from 'node:assert/strict';
import test from 'node:test';

const { eurosToCents, formatCentsInput } = await import('./amount');

test('eurosToCents rounds to whole cents', () => {
	assert.equal(eurosToCents(0.1 + 0.2), 30);
	assert.equal(eurosToCents(12.345), 1235);
	assert.equal(eurosToCents(0), 0);
});

test('formatCentsInput renders German input text', () => {
	assert.equal(formatCentsInput(1250), '12,50');
	assert.equal(formatCentsInput(5), '0,05');
});
