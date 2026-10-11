import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PgDialect, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const id = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const wgId = '44444444-4444-4444-8444-444444444444';

const wgChatMessages = pgTable('wg_chat_messages', {
	id: uuid('id'),
	wgId: uuid('wg_id'),
	senderMemberId: uuid('sender_member_id'),
	kind: text('kind'),
	body: text('body'),
	deletedAt: timestamp('deleted_at', { withTimezone: true }),
	editedAt: timestamp('edited_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }),
});

const wgChatMentions = pgTable('wg_chat_mentions', {
	messageId: uuid('message_id'),
	mentionedMemberId: uuid('mentioned_member_id'),
});
const wgMembers = pgTable('wg_members', {
	id: uuid('id'),
	wgId: uuid('wg_id'),
	name: text('name'),
});

const annaId = '55555555-5555-4555-8555-555555555555';
const state = {
	updateWhere: '',
	updateRows: [] as unknown[],
	audits: 0,
	deletedMentionTables: [] as unknown[],
	insertedMentions: [] as unknown[],
};

const db = {
	select: (projection?: unknown) => (projection ? db.selectMembers() : db.selectMessage()),
	selectMessage: () => ({
		from: () => ({
			where: () => ({
				limit: async () => [
					{ id, senderMemberId: memberId, kind: 'text', deletedAt: null, createdAt: new Date() },
				],
			}),
		}),
	}),
	// Members of the WG: the sender and Anna.
	selectMembers: () => ({
		from: () => ({
			where: async () => [
				{ id: memberId, name: 'Member' },
				{ id: annaId, name: 'Anna' },
			],
		}),
	}),
	delete: (table: unknown) => ({
		where: async () => {
			state.deletedMentionTables.push(table);
		},
	}),
	insert: () => ({
		values: (rows: unknown) => ({
			onConflictDoNothing: async () => {
				state.insertedMentions.push(rows);
			},
		}),
	}),
	update: () => ({
		set: () => ({
			where: (condition: never) => ({
				returning: async () => {
					state.updateWhere = new PgDialect().sqlToQuery(condition).sql;
					return state.updateRows;
				},
			}),
		}),
	}),
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => state.audits++ } });
mock.module('@/core/db', { namedExports: { db, wgChatMentions, wgChatMessages, wgMembers } });
mock.module('@/core/db/private-image-deletions', {
	namedExports: { revokePrivateImageIfUnreferenced: async () => undefined },
});
mock.module('@/core/db/transaction', {
	namedExports: {
		lockExpensePayments: async () => undefined,
		withTransaction: async (work: (tx: unknown) => unknown) => work(db),
	},
});
mock.module('@/core/guards/admin', { namedExports: { requireOwnerOrAdmin: async () => null } });
mock.module('@/core/guards/api-auth', { namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i } });
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId },
			member: { memberId, name: 'Member' },
		}),
	},
});
mock.module('@/core/guards/with-wg-route', {
	namedExports: {
		withWgRoute:
			(_label: string, handler: (req: Request, params: unknown) => unknown) =>
			async (req: Request, ctx: { params: Promise<unknown> }) =>
				handler(req, await ctx.params),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { wgWriteLimiter: {}, checkRateLimit: async () => ({ success: true }) },
});

const { PATCH } = await import('./route');

function patch(body = 'neuer Text') {
	return PATCH(
		new Request('https://example.invalid', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ body }),
		}) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT', id }) } as never,
	);
}

test('an edit that loses the race against a delete answers 409 and writes no audit event', async () => {
	state.updateRows = [];
	state.audits = 0;
	const response = await patch();
	assert.equal(response.status, 409);
	assert.equal(((await response.json()) as { error: string }).error, 'message_deleted');
	assert.equal(state.audits, 0);
	// The UPDATE itself must refuse deleted rows, other authors and non-text messages.
	assert.match(state.updateWhere, /"deleted_at" is null/);
	assert.match(state.updateWhere, /"sender_member_id" = \$/);
	assert.match(state.updateWhere, /"kind" = \$/);
});

test('an edit of a live message still succeeds', async () => {
	state.updateRows = [{ id, body: 'neuer Text' }];
	state.audits = 0;
	const response = await patch();
	assert.equal(response.status, 200);
	assert.equal(state.audits, 1);
});

test('an edit re-derives the mention rows from the new text in the same transaction', async () => {
	state.updateRows = [{ id, body: 'Hi @Anna' }];
	state.deletedMentionTables = [];
	state.insertedMentions = [];
	assert.equal((await patch('Hi @Anna')).status, 200);
	assert.deepEqual(state.insertedMentions, [[{ messageId: id, mentionedMemberId: annaId }]]);

	// Dropping the name removes the old mention rows and inserts none.
	state.deletedMentionTables = [];
	state.insertedMentions = [];
	assert.equal((await patch('Hi')).status, 200);
	assert.deepEqual(state.deletedMentionTables, [wgChatMentions]);
	assert.deepEqual(state.insertedMentions, []);
});
