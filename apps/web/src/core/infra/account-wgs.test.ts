import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAccountWgs } from './account-wgs';

const wg = { id: 'wg-1', code: 'mte8pzat', name: '  Altbau ' };

test('normalizes code and name of valid entries', () => {
	assert.deepEqual(parseAccountWgs({ wgs: [wg] }), [
		{ id: 'wg-1', code: 'MTE8PZAT', name: 'Altbau' },
	]);
	assert.deepEqual(parseAccountWgs({ wgs: [] }), []);
});

test('rejects a malformed body or any malformed entry', () => {
	assert.equal(parseAccountWgs(null), null);
	assert.equal(parseAccountWgs([]), null);
	assert.equal(parseAccountWgs({}), null);
	assert.equal(parseAccountWgs({ wgs: [wg, { ...wg, code: 'kurz' }] }), null);
	assert.equal(parseAccountWgs({ wgs: [{ ...wg, name: '   ' }] }), null);
	assert.equal(parseAccountWgs({ wgs: [{ ...wg, id: '' }] }), null);
});

test('keeps a non-empty memberId and drops anything else without rejecting the list', () => {
	assert.deepEqual(parseAccountWgs({ wgs: [{ ...wg, memberId: 'm-1' }] }), [
		{ id: 'wg-1', code: 'MTE8PZAT', name: 'Altbau', memberId: 'm-1' },
	]);
	for (const memberId of ['', 7, null, {}]) {
		assert.deepEqual(parseAccountWgs({ wgs: [{ ...wg, memberId }] }), [
			{ id: 'wg-1', code: 'MTE8PZAT', name: 'Altbau' },
		]);
	}
});
