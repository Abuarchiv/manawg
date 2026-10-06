import assert from 'node:assert/strict';
import test from 'node:test';

const { LIMITS } = await import('../src/core/db/schema.ts');
const { MEMBER_NAME_MAX_LENGTH } = await import('../src/shared/lib/limits.ts');

test('client and database agree on the member name limit', () => {
	assert.equal(MEMBER_NAME_MAX_LENGTH, LIMITS.NAME_MAX);
});
