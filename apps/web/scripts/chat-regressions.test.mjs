import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import * as chat from '../src/features/chat/chat-pure.ts';
import * as chatReadQuery from '../src/features/chat/chat-read-query.ts';

let unreadQuery;
try {
	unreadQuery = await import('../src/features/chat/chat-unread-query.ts');
} catch {
	unreadQuery = {};
}

test('sanitizes deleted chat messages while retaining reply identity', () => {
	const deleted = {
		id: 'deleted-message',
		senderMemberId: 'member-a',
		body: 'private text',
		imageUrl: 'https://example.test/private.jpg',
		systemPayload: { description: 'private system detail' },
		replyToMessageId: 'parent-message',
		deletedAt: '2026-09-23T18:00:00.000Z',
	};

	assert.deepEqual(chat.sanitizeChatMessageForRead?.(deleted), {
		...deleted,
		body: null,
		imageUrl: null,
		systemPayload: null,
	});
});

test('refresh replaces loaded reactions from the server and preserves a pending local mutation', () => {
	const existing = [
		{ messageId: 'loaded-a', memberId: 'member-a', emoji: '💙' },
		{ messageId: 'loaded-a', memberId: 'member-b', emoji: '😕' },
		{ messageId: 'loaded-b', memberId: 'member-a', emoji: '🔥' },
	];
	const server = [
		{ messageId: 'loaded-a', memberId: 'member-b', emoji: '👏' },
		{ messageId: 'loaded-a', memberId: 'member-c', emoji: '❤️' },
	];

	assert.deepEqual(
		chat.reconcileChatReactions?.(
			existing,
			server,
			new Set(['loaded-a']),
			new Set(['loaded-a|member-a|💙']),
		),
		[
			{ messageId: 'loaded-b', memberId: 'member-a', emoji: '🔥' },
			{ messageId: 'loaded-a', memberId: 'member-b', emoji: '👏' },
			{ messageId: 'loaded-a', memberId: 'member-c', emoji: '❤️' },
			{ messageId: 'loaded-a', memberId: 'member-a', emoji: '💙' },
		],
	);
});

test('refresh protects reaction mutations that are pending or completed after it started', () => {
	const versions = new Map([
		['loaded-a|member-a|💙', { messageId: 'loaded-a', version: 2 }],
		['loaded-a|member-b|👏', { messageId: 'loaded-a', version: 3 }],
		['loaded-a|member-c|❤️', { messageId: 'loaded-a', version: 7 }],
		['loaded-b|member-a|🔥', { messageId: 'loaded-b', version: 4 }],
	]);

	assert.deepEqual(
		chat.reactionKeysToPreserve?.(
			versions,
			new Set(['loaded-a|member-a|💙']),
			new Map([
				['loaded-a|member-a|💙', 2],
				['loaded-a|member-b|👏', 2],
				['loaded-a|member-c|❤️', 7],
				['loaded-b|member-a|🔥', 3],
			]),
			new Set(['loaded-a']),
		),
		new Set(['loaded-a|member-a|💙', 'loaded-a|member-b|👏']),
	);
});

test('refresh replaces stale content for loaded older messages with tombstones', () => {
	const oldMessage = {
		id: 'older-message',
		createdAt: '2026-09-23T10:00:00.000Z',
		body: 'deleted text must not remain visible',
		imageUrl: null,
		deletedAt: null,
	};
	const latestMessage = {
		id: 'latest-message',
		createdAt: '2026-09-23T12:00:00.000Z',
		body: 'still visible',
		imageUrl: null,
		deletedAt: null,
	};
	const tombstone = {
		...oldMessage,
		body: null,
		deletedAt: '2026-09-23T13:00:00.000Z',
	};

	assert.deepEqual(
		chat.reconcileChatMessages?.([oldMessage, latestMessage], [latestMessage], [tombstone]),
		[tombstone, latestMessage],
	);
});

test('older message refresh batches are bounded and rotate through loaded IDs', () => {
	const loaded = Array.from({ length: 7 }, (_, index) => ({ id: `message-${index}` }));

	assert.deepEqual(chat.nextChatRefreshBatch?.(loaded, 2, 3, 0), {
		ids: ['message-0', 'message-1', 'message-2'],
		nextOffset: 3,
	});
	assert.deepEqual(chat.nextChatRefreshBatch?.(loaded, 2, 3, 3), {
		ids: ['message-3', 'message-4'],
		nextOffset: 0,
	});
});

test('unread chat query excludes soft-deleted messages', () => {
	const messages = pgTable('wg_chat_messages', {
		id: uuid('id'),
		wgId: uuid('wg_id'),
		senderMemberId: uuid('sender_member_id'),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }),
	});
	const where = unreadQuery.buildUnreadChatMessagesWhere?.(
		messages,
		'00000000-0000-4000-8000-000000000001',
		'00000000-0000-4000-8000-000000000002',
		new Date('2026-09-24T00:00:00.000Z'),
		'00000000-0000-4000-8000-000000000003',
	);
	assert.ok(where, 'unread query builder must provide a filter');
	const query = new PgDialect().sqlToQuery(where);
	assert.match(query.sql, /deleted_at" is null/i);
	assert.match(query.sql, /\("wg_chat_messages"\."created_at", "wg_chat_messages"\."id"\) > \(/i);
	assert.match(query.sql, /select cursor\.created_at, cursor\.id/i);
	assert.ok(!query.params.includes('2026-09-24T00:00:00.000Z'));
	assert.deepEqual(query.params.slice(-2), [
		'00000000-0000-4000-8000-000000000003',
		'00000000-0000-4000-8000-000000000001',
	]);
	const older = unreadQuery.buildChatCursorWhere?.(
		messages,
		'00000000-0000-4000-8000-000000000001',
		'00000000-0000-4000-8000-000000000003',
		'before',
	);
	assert.ok(older, 'pagination must compare the same database cursor in reverse');
	assert.match(
		new PgDialect().sqlToQuery(older).sql,
		/\) < \(\s*select cursor\.created_at, cursor\.id/i,
	);
});

test('chat read marker advances by timestamp and message id', () => {
	const reads = pgTable('wg_chat_reads', {
		lastReadMessageId: uuid('last_read_message_id'),
	});
	const where = chatReadQuery.buildChatReadMarkerSetWhere?.(
		'00000000-0000-4000-8000-000000000003',
		reads.lastReadMessageId,
	);
	assert.ok(where, 'read marker query builder must provide a filter');
	const query = new PgDialect().sqlToQuery(where);
	assert.match(query.sql, /last_read_message_id" is null/i);
	assert.match(query.sql, /candidate\.created_at[\s\S]*?\) > coalesce/i);
	assert.match(query.sql, /candidate\.created_at[\s\S]*?\) = coalesce/i);
	assert.match(query.sql, /::uuid > "wg_chat_reads"\."last_read_message_id"/i);
});

test('read payload keeps the latest page and older refresh updates in separate fields', () => {
	const pageTombstone = {
		id: 'page-deleted',
		body: 'hidden page content',
		imageUrl: null,
		deletedAt: '2026-09-23T14:00:00.000Z',
	};
	const olderTombstone = {
		id: 'older-deleted',
		body: 'hidden older content',
		imageUrl: null,
		deletedAt: '2026-09-23T13:00:00.000Z',
	};

	assert.deepEqual(chat.chatMessagesReadPayload?.([pageTombstone], [olderTombstone]), {
		messages: [{ ...pageTombstone, body: null }],
		refreshedMessages: [{ ...olderTombstone, body: null }],
	});
	assert.deepEqual(chat.chatMessagesReadPayload?.([], [olderTombstone]), {
		messages: [],
		refreshedMessages: [{ ...olderTombstone, body: null }],
	});
});

test('late older refresh response cannot overwrite a newer tombstone', () => {
	let latestRequestId = 0;
	const staleRequestId = ++latestRequestId;
	const tombstoneRequestId = ++latestRequestId;
	let visibleMessage = 'live body';

	if (chat.isLatestChatRefreshResponse?.(tombstoneRequestId, latestRequestId)) {
		visibleMessage = 'tombstone';
	}
	if (chat.isLatestChatRefreshResponse?.(staleRequestId, latestRequestId)) {
		visibleMessage = 'stale live body';
	}
	assert.equal(visibleMessage, 'tombstone');
});

test('GET started before successful delete cannot restore the deleted body', () => {
	let latestRequestId = 1;
	const oldGetRequestId = latestRequestId;
	let visibleBody = 'body to delete';

	latestRequestId = chat.advanceChatRefreshSequence?.(latestRequestId) ?? latestRequestId;
	visibleBody = null;
	if (chat.isLatestChatRefreshResponse?.(oldGetRequestId, latestRequestId)) {
		visibleBody = 'body to delete';
	}

	assert.equal(visibleBody, null);
});
