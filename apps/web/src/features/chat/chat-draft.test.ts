import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const values = new Map<string, string>();
const storage: Storage = {
	get length() {
		return values.size;
	},
	clear() {
		values.clear();
	},
	getItem(key) {
		return values.get(key) ?? null;
	},
	key(index) {
		return [...values.keys()][index] ?? null;
	},
	removeItem(key) {
		values.delete(key);
	},
	setItem(key, value) {
		values.set(key, value);
	},
};

mock.module('@/core/utils/browser', {
	namedExports: { safeLocalStorage: () => storage },
});
const { readChatDraft, writeChatDraft } = await import('./chat-draft');

test('composer draft writes keep a pending send key', () => {
	const key = 'manawg:draft:MTE8PZAT:member-a:chat';
	const pendingSend = {
		fingerprint: JSON.stringify({ body: 'Hallo', mentionMemberIds: [], replyToMessageId: null }),
		key: '11111111-1111-4111-8111-111111111111',
		createdAtMs: 1_798_653_600_000,
	};
	assert.equal(writeChatDraft(key, { body: 'Hallo', replyToMessageId: null, pendingSend }), true);
	assert.equal(
		writeChatDraft(key, { body: 'Entwurf geändert', replyToMessageId: 'reply-1' }),
		true,
	);
	assert.deepEqual(readChatDraft(key, 4000), {
		body: 'Entwurf geändert',
		replyToMessageId: 'reply-1',
		pendingSend,
	});

	assert.equal(
		writeChatDraft(key, {
			body: 'Entwurf geändert',
			replyToMessageId: 'reply-1',
			pendingSend: null,
		}),
		true,
	);
	assert.equal(readChatDraft(key, 4000).pendingSend, null);
});

test('an invalid stored key never counts as a safe retry', () => {
	const key = 'manawg:draft:MTE8PZAT:member-a:chat';
	storage.setItem(
		key,
		JSON.stringify({
			body: 'Hallo',
			replyToMessageId: null,
			pendingSend: { fingerprint: 'payload', key: 'not-a-uuid', createdAtMs: 1_798_653_600_000 },
		}),
	);
	const draft = readChatDraft(key, 4000);
	assert.equal(draft.pendingSend?.key, 'not-a-uuid');
});
