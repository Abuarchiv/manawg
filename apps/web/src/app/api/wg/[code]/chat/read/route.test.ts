import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';

const wgChatReads = {
	wgId: 'wg_chat_reads.wg_id',
	memberId: 'wg_chat_reads.member_id',
	lastReadMessageId: 'wg_chat_reads.last_read_message_id',
};
const wgChatMessages = { id: 'wg_chat_messages.id', wgId: 'wg_chat_messages.wg_id' };

const state = {
	changedRows: [] as unknown[],
	upsert: null as {
		values: Record<string, unknown>;
		config: { set: Record<string, unknown> };
	} | null,
	markerCalls: [] as unknown[],
};

const db = {
	select: () => ({
		from: () => ({ where: () => ({ limit: async () => [{ id: messageId }] }) }),
	}),
	insert: (table: unknown) => {
		assert.equal(table, wgChatReads);
		return {
			values: (values: Record<string, unknown>) => ({
				onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
					state.upsert = { values, config };
					return { returning: async () => state.changedRows };
				},
			}),
		};
	},
};

mock.module('@/core/db', { namedExports: { db, wgChatMessages, wgChatReads } });
mock.module('@/core/guards/api-auth', { namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i } });
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({ ok: true, wg: { id: wgId }, member: { memberId } }),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { chatReadLimiter: {}, checkRateLimit: async () => ({ success: true }) },
});
mock.module('@/features/chat/chat-read-query', {
	namedExports: {
		buildChatReadMarkerSetWhere: (candidate: unknown, current: unknown) => {
			state.markerCalls.push([candidate, current]);
			return { candidate };
		},
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...parts: unknown[]) => parts,
		eq: (...parts: unknown[]) => parts,
	},
});

const { POST } = await import('./route');

function harness({ changedRows }: { changedRows: unknown[] }) {
	state.changedRows = changedRows;
	state.upsert = null;
	state.markerCalls = [];
	const post = (lastReadMessageId: string | null) =>
		POST(
			new Request('https://example.invalid/api/wg/MTE8PZAT/chat/read', {
				method: 'POST',
				body: JSON.stringify({ lastReadMessageId }),
			}) as never,
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
		);
	return { post, state, wgChatReads };
}

test('a null read marker resets the stored marker and reports the change', async () => {
	const { post, state, wgChatReads } = harness({ changedRows: [{ memberId }] });

	const response = await post(null);

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true, applied: true });
	assert.equal(state.upsert?.values.lastReadMessageId, null);
	assert.equal(state.upsert?.config.set.lastReadMessageId, null);
	assert.deepEqual(state.markerCalls, [[null, wgChatReads.lastReadMessageId]]);
});

test('an ignored read receipt reports applied: false', async () => {
	for (const lastReadMessageId of [null, messageId]) {
		const { post } = harness({ changedRows: [] });

		const response = await post(lastReadMessageId);

		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { ok: true, applied: false });
	}
});
