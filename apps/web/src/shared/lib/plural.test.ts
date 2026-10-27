import assert from 'node:assert/strict';
import test from 'node:test';

const { pluralize } = await import('./plural');

test('pluralize picks the singular only for exactly one', () => {
	assert.equal(pluralize(1, 'Tag', 'Tagen'), '1 Tag');
	assert.equal(pluralize(0, 'Tag', 'Tagen'), '0 Tagen');
	assert.equal(pluralize(2, 'Tag', 'Tagen'), '2 Tagen');
});
