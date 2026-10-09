import assert from 'node:assert/strict';
import test from 'node:test';
import { signUnsubscribeToken, verifyUnsubscribeToken } from './statement-unsubscribe';

const MEMBER = '8f3a1c9e-4b7d-4a21-9c55-0d6e7f8a9b10';
const OTHER = '11111111-4b7d-4a21-9c55-0d6e7f8a9b10';
const SECRET = 'test-secret';

test('a signed token verifies to its member id', () => {
	assert.equal(verifyUnsubscribeToken(signUnsubscribeToken(MEMBER, SECRET), SECRET), MEMBER);
});

test('tampered, foreign or malformed tokens are rejected', () => {
	const token = signUnsubscribeToken(MEMBER, SECRET);
	const [, mac = ''] = token.split('.');
	assert.equal(verifyUnsubscribeToken(`${OTHER}.${mac}`, SECRET), null);
	assert.equal(verifyUnsubscribeToken(`${token}x`, SECRET), null);
	assert.equal(verifyUnsubscribeToken(token, 'other-secret'), null);
	assert.equal(verifyUnsubscribeToken(token, null), null);
	assert.equal(verifyUnsubscribeToken(`${MEMBER}.`, SECRET), null);
	assert.equal(verifyUnsubscribeToken('not-a-token', SECRET), null);
	assert.equal(verifyUnsubscribeToken(`${token}.extra`, SECRET), null);
});
