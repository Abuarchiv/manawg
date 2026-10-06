import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { buildChatCursorWhere, buildUnreadChatMessagesWhere } from './chat-unread-query';

// The builders only produce SQL; without a database the rendered statement and its bind
// parameters are the observable contract.

test('unread chat query excludes soft-deleted messages', () => {
	const messages = pgTable('wg_chat_messages', {
		id: uuid('id'),
		wgId: uuid('wg_id'),
		senderMemberId: uuid('sender_member_id'),
		systemPayload: jsonb('system_payload'),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }),
	});
	const where = buildUnreadChatMessagesWhere(
		messages,
		'00000000-0000-4000-8000-000000000001',
		'00000000-0000-4000-8000-000000000002',
		new Date('2026-09-24T00:00:00.000Z'),
		'00000000-0000-4000-8000-000000000003',
	);
	assert.ok(where, 'unread query builder must provide a filter');
	const query = new PgDialect().sqlToQuery(where);
	assert.match(query.sql, /deleted_at" is null/i);
	assert.match(
		query.sql,
		/coalesce\("wg_chat_messages"\."system_payload"->>'actorMemberId', ''\) <> \$/i,
	);
	assert.match(query.sql, /\("wg_chat_messages"\."created_at", "wg_chat_messages"\."id"\) > \(/i);
	assert.match(query.sql, /select cursor\.created_at, cursor\.id/i);
	assert.ok(!query.params.includes('2026-09-24T00:00:00.000Z'));
	assert.deepEqual(query.params.slice(-2), [
		'00000000-0000-4000-8000-000000000003',
		'00000000-0000-4000-8000-000000000001',
	]);
	const older = buildChatCursorWhere(
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
