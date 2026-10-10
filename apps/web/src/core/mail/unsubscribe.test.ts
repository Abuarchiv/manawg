import assert from 'node:assert/strict';
import test from 'node:test';
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe';

const MEMBER = '8f3a1c9e-4b7d-4a21-9c55-0d6e7f8a9b10';
const SECRET = 'test-secret';

test('statement tokens keep the two-part format already in sent mails', () => {
	const token = signUnsubscribeToken(MEMBER, 'statement', SECRET);
	assert.equal(token.split('.').length, 2);
	assert.deepEqual(verifyUnsubscribeToken(token, SECRET), { memberId: MEMBER, kind: 'statement' });
});

test('digest and reminder tokens name their kind and verify to it', () => {
	for (const kind of ['digest', 'reminders'] as const) {
		const token = signUnsubscribeToken(MEMBER, kind, SECRET);
		assert.equal(token.split('.')[1], kind);
		assert.deepEqual(verifyUnsubscribeToken(token, SECRET), { memberId: MEMBER, kind });
	}
});

test('a kind cannot be swapped without re-signing', () => {
	const token = signUnsubscribeToken(MEMBER, 'digest', SECRET);
	const mac = token.split('.')[2] ?? '';
	assert.equal(verifyUnsubscribeToken(`${MEMBER}.reminders.${mac}`, SECRET), null);
	assert.equal(verifyUnsubscribeToken(`${MEMBER}.${mac}`, SECRET), null);
	assert.equal(verifyUnsubscribeToken(`${MEMBER}.unknown.${mac}`, SECRET), null);
});
