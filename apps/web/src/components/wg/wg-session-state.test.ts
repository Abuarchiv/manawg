import assert from 'node:assert/strict';
import test from 'node:test';
import { initWgSessionState, wgSessionReducer } from './wg-session-state';

const accountA = {
	memberId: 'member-a',
	name: 'Mina',
	authUserId: 'account-a',
};

test('resets admin rights on an account switch but not on a rename', () => {
	const initial = initWgSessionState(accountA, true);
	const accountB = wgSessionReducer(initial, {
		type: 'member-loaded',
		identity: { memberId: 'member-b', name: 'Bea', authUserId: 'account-b' },
	});
	assert.equal(accountB.isAdmin, false);
	assert.equal(accountB.identity?.authUserId, 'account-b');

	const renamed = wgSessionReducer(initial, {
		type: 'member-loaded',
		identity: { ...accountA, name: 'Mina geändert' },
	});
	assert.equal(renamed.isAdmin, true);
});
