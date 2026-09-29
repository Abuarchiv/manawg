import assert from 'node:assert/strict';
import test from 'node:test';
import { canDeleteMessage, canEditMessage } from './chat-pure.ts';

const createdAt = '2026-09-23T10:00:00.000Z';
const own = { id: 'm1', senderMemberId: 'me', kind: 'text', createdAt };

test('only the sender can edit a live text message within the edit window', () => {
	const at = (minutes) => Date.parse(createdAt) + minutes * 60_000;
	assert.equal(canEditMessage(own, { id: 'me' }, at(15)), true);
	assert.equal(canEditMessage(own, { id: 'me' }, at(16)), false);
	assert.equal(canEditMessage(own, { id: 'bob', role: 'admin' }, at(1)), false);
	assert.equal(canEditMessage({ ...own, kind: 'system' }, { id: 'me' }, at(1)), false);
	assert.equal(canEditMessage({ ...own, deletedAt: createdAt }, { id: 'me' }, at(1)), false);
});

test('senders and admins can delete; system messages only admins', () => {
	assert.equal(canDeleteMessage(own, { id: 'me' }), true);
	assert.equal(canDeleteMessage(own, { id: 'bob' }), false);
	assert.equal(canDeleteMessage(own, { id: 'bob', role: 'admin' }), true);
	assert.equal(canDeleteMessage({ ...own, kind: 'system' }, { id: 'me' }), false);
});
