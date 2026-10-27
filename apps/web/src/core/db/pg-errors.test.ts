import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findUniqueViolation, isUniqueViolation } from './pg-errors';

test('finds a direct unique violation with its constraint', () => {
	const err = { code: '23505', constraint: 'a_idx' };
	assert.deepEqual(findUniqueViolation(err), { constraint: 'a_idx' });
	assert.equal(isUniqueViolation(err), true);
	assert.equal(isUniqueViolation(err, 'a_idx'), true);
	assert.equal(isUniqueViolation(err, 'other'), false);
});

test('walks the cause chain', () => {
	const err = new Error('wrapped', {
		cause: new Error('mid', { cause: { code: '23505', constraint: 'deep' } }),
	});
	assert.deepEqual(findUniqueViolation(err), { constraint: 'deep' });
	assert.equal(isUniqueViolation(err, 'deep'), true);
});

test('reads constraint_name when constraint is missing', () => {
	assert.deepEqual(findUniqueViolation({ code: '23505', constraint_name: 'named' }), {
		constraint: 'named',
	});
});

test('reports a null constraint when none is present', () => {
	assert.deepEqual(findUniqueViolation({ code: '23505' }), { constraint: null });
	assert.equal(isUniqueViolation({ code: '23505' }), true);
	assert.equal(isUniqueViolation({ code: '23505' }, 'a_idx'), false);
});

test('terminates on a cyclic cause chain', () => {
	const a: { cause?: unknown } = {};
	const b: { cause?: unknown } = { cause: a };
	a.cause = b;
	assert.equal(findUniqueViolation(a), null);
	assert.equal(isUniqueViolation(a), false);
});

test('ignores other Postgres codes and non-objects', () => {
	assert.equal(findUniqueViolation({ code: '23503', constraint: 'a_idx' }), null);
	assert.equal(findUniqueViolation(new Error('x', { cause: { code: '40001' } })), null);
	assert.equal(findUniqueViolation(null), null);
	assert.equal(findUniqueViolation('23505'), null);
});
