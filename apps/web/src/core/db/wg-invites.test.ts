import assert from 'node:assert/strict';
import test from 'node:test';
import { inviteStatus, needsFreshInvite } from './wg-invites';

const NOW = new Date('2026-10-11T12:00:00Z');
const base = {
	expiresAt: new Date('2026-10-18T12:00:00Z'),
	revokedAt: null,
	useCount: 0,
	maxUses: 10,
};

test('an unused invitation before its expiry is valid', () => {
	assert.equal(inviteStatus(base, NOW), 'valid');
});

test('expiry, revocation and a used-up counter each end the invitation', () => {
	assert.equal(inviteStatus({ ...base, expiresAt: NOW }, NOW), 'expired');
	assert.equal(inviteStatus({ ...base, revokedAt: NOW }, NOW), 'revoked');
	assert.equal(inviteStatus({ ...base, useCount: 10 }, NOW), 'exhausted');
});

test('the invite card needs a fresh link once the newest one is dead', () => {
	assert.equal(needsFreshInvite(null, NOW), true, 'no invitation yet');
	assert.equal(needsFreshInvite({ ...base, expiresAt: NOW }, NOW), true, 'expired');
	assert.equal(needsFreshInvite({ ...base, useCount: 10 }, NOW), true, 'used up');
	assert.equal(needsFreshInvite({ ...base, revokedAt: NOW }, NOW), true, 'revoked');
	assert.equal(needsFreshInvite(base, NOW), false, 'valid');
});
