import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect, pgTable, uuid } from 'drizzle-orm/pg-core';
import { buildChatReadMarkerSetWhere } from './chat-read-query';

// The builder only produces SQL; without a database the rendered statement and its bind
// parameters are the observable contract.

test('chat read marker advances by timestamp and message id', () => {
	const reads = pgTable('wg_chat_reads', {
		lastReadMessageId: uuid('last_read_message_id'),
	});
	const where = buildChatReadMarkerSetWhere(
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

test('null chat read marker resets a set marker instead of matching nothing', () => {
	const reads = pgTable('wg_chat_reads', {
		lastReadMessageId: uuid('last_read_message_id'),
	});
	const where = buildChatReadMarkerSetWhere(null, reads.lastReadMessageId);
	const query = new PgDialect().sqlToQuery(where);
	assert.match(query.sql, /^"wg_chat_reads"\."last_read_message_id" is not null$/i);
	assert.deepEqual(query.params, []);
});
