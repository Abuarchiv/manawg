import assert from 'node:assert/strict';
import test from 'node:test';
import { toChatUnreadCountResponse } from './chat-unread-count';

test('unread count response preserves the exact total and caps only the visible count', () => {
	assert.deepEqual(toChatUnreadCountResponse(147), {
		count: 99,
		exactCount: 147,
		overflow: true,
	});
	assert.deepEqual(toChatUnreadCountResponse(99), {
		count: 99,
		exactCount: 99,
		overflow: false,
	});
});
