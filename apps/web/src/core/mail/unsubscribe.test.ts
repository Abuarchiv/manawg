import assert from 'node:assert/strict';
import test from 'node:test';
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe';

const MEMBER = '8f3a1c9e-4b7d-4a21-9c55-0d6e7f8a9b10';
const OTHER = '11111111-4b7d-4a21-9c55-0d6e7f8a9b10';
const SECRET = 'test-secret';

test('statement tokens keep the two-part format already in sent mails', () => {
	const token = signUnsubscribeToken(MEMBER, 'statement', SECRET);
	assert.equal(token.split('.').length, 2);
	assert.deepEqual(verifyUnsubscribeToken(token, SECRET), { memberId: MEMBER, kind: 'statement' });
});

test('reminder tokens name their kind and verify to it', () => {
	const token = signUnsubscribeToken(MEMBER, 'reminders', SECRET);
	assert.equal(token.split('.')[1], 'reminders');
	assert.deepEqual(verifyUnsubscribeToken(token, SECRET), { memberId: MEMBER, kind: 'reminders' });
});

test('a kind cannot be swapped without re-signing', () => {
	const token = signUnsubscribeToken(MEMBER, 'reminders', SECRET);
	const mac = token.split('.')[2] ?? '';
	assert.equal(verifyUnsubscribeToken(`${MEMBER}.statement.${mac}`, SECRET), null);
	assert.equal(verifyUnsubscribeToken(`${MEMBER}.${mac}`, SECRET), null);
	assert.equal(verifyUnsubscribeToken(`${MEMBER}.unknown.${mac}`, SECRET), null);
});

test('tampered, foreign or malformed tokens are rejected', () => {
	const token = signUnsubscribeToken(MEMBER, 'statement', SECRET);
	const [, mac = ''] = token.split('.');
	assert.equal(verifyUnsubscribeToken(`${OTHER}.${mac}`, SECRET), null);
	assert.equal(verifyUnsubscribeToken(`${token}x`, SECRET), null);
	assert.equal(verifyUnsubscribeToken(token, 'other-secret'), null);
	assert.equal(verifyUnsubscribeToken(token, null), null);
	assert.equal(verifyUnsubscribeToken(`${MEMBER}.`, SECRET), null);
	assert.equal(verifyUnsubscribeToken('not-a-token', SECRET), null);
	assert.equal(verifyUnsubscribeToken(`${token}.extra`, SECRET), null);
});

test('a token signed with a previous secret verifies while that secret is still accepted', () => {
	const token = signUnsubscribeToken(MEMBER, 'statement', 'old-secret');
	assert.deepEqual(verifyUnsubscribeToken(token, ['new-secret', 'old-secret']), {
		memberId: MEMBER,
		kind: 'statement',
	});
	assert.equal(verifyUnsubscribeToken(token, ['new-secret']), null);
});
