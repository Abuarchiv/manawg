import assert from 'node:assert/strict';
import test from 'node:test';
import { inviteStatus } from './wg-invites';

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
