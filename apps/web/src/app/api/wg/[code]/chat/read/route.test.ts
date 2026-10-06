import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockDb } from '../../../../../../../tests/support/db-mock';
import { mockDrizzle } from '../../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../tests/support/route-harness';

const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';

const wgChatReads = {
	wgId: 'wg_chat_reads.wg_id',
	memberId: 'wg_chat_reads.member_id',
	lastReadMessageId: 'wg_chat_reads.last_read_message_id',
};
const wgChatMessages = { id: 'wg_chat_messages.id', wgId: 'wg_chat_messages.wg_id' };

interface Upsert {
	values: { lastReadMessageId: string | null };
	config: { set: { lastReadMessageId: string | null }; setWhere: unknown };
}

const state = { changedRows: [] as unknown[], upsert: null as Upsert | null };

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: wgId }, member: { memberId, name: 'Mina' } });
mockDb({
	wgChatMessages,
	wgChatReads,
	db: {
		select: () => ({
			from: () => ({ where: () => ({ limit: async () => [{ id: messageId }] }) }),
		}),
		insert: (table: unknown) => {
			assert.equal(table, wgChatReads);
			return {
				values: (values: Upsert['values']) => ({
					onConflictDoUpdate: (config: Upsert['config']) => {
						state.upsert = { values, config };
						return { returning: async () => state.changedRows };
					},
				}),
			};
		},
	},
});

const { POST } = await import('./route');
const { buildChatReadMarkerSetWhere } = await import('@/features/chat/chat-read-query');

function post(lastReadMessageId: string | null, changedRows: unknown[]) {
	state.changedRows = changedRows;
	state.upsert = null;
	return POST(
		request('/api/wg/MTE8PZAT/chat/read', { method: 'POST', body: { lastReadMessageId } }),
		routeCtx(),
	);
}

test('a null read marker resets the stored marker and reports the change', async () => {
	const response = await post(null, [{ memberId }]);

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true, applied: true });
	assert.equal(state.upsert?.values.lastReadMessageId, null);
	assert.equal(state.upsert?.config.set.lastReadMessageId, null);
	assert.deepEqual(
		state.upsert?.config.setWhere,
		buildChatReadMarkerSetWhere(null, wgChatReads.lastReadMessageId as never),
	);
});

test('an ignored read receipt reports applied: false', async () => {
	for (const lastReadMessageId of [null, messageId]) {
		const response = await post(lastReadMessageId, []);

		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { ok: true, applied: false });
	}
});
