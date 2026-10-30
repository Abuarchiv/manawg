import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { INVALID_RESPONSE_CODE } from '@/core/http/error-codes';
import { OFFLINE_REPLAY_MAX_AGE_MS } from '@/core/offline/replay-retention';
import type { ChatMessageInput, PendingChatSend, PendingChatSendRequest } from './chat-send';

type ApiResult = { ok: true; data: unknown } | { ok: false; status: number; error: string };
type ApiInit = { headers?: HeadersInit | undefined };

const calls: string[] = [];
const requestKeys: string[] = [];
const persisted: Array<PendingChatSendRequest | null> = [];
let result: ApiResult = { ok: false, status: 400, error: 'reply_to_not_found' };
mock.module('@/core/infra/api-client', {
	namedExports: {
		apiFetch: async (_url: string, init?: ApiInit) => {
			calls.push('request');
			requestKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
			return result;
		},
	},
});

const { postChatMessage } = await import('./chat-send');

const input: ChatMessageInput = {
	body: 'Hallo',
	mentionMemberIds: [],
	replyToMessageId: null,
};
const validMessage = {
	id: 'message-1',
	wgId: 'wg-1',
	senderMemberId: 'member-a',
	kind: 'text',
	body: input.body,
	imageUrl: null,
	replyToMessageId: null,
	createdAt: '2026-10-30T10:00:00.000Z',
	editedAt: null,
	deletedAt: null,
};
const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_OLD = '99999999-9999-4999-8999-999999999999';

function reset(nextResult: ApiResult): void {
	calls.length = 0;
	requestKeys.length = 0;
	persisted.length = 0;
	result = nextResult;
}

function options(
	pending: PendingChatSend,
	persistPending: (value: PendingChatSendRequest | null) => boolean = (value) => {
		calls.push(value ? 'persist' : 'clear');
		persisted.push(value);
		return true;
	},
) {
	return {
		messagesUrl: '/api/wg/MTE8PZAT/chat/messages',
		memberId: 'member-a',
		pending,
		createKey: () => KEY_A,
		persistPending,
	};
}

test('persists the retry key before the POST and releases it after a safe rejection', async () => {
	reset({ ok: false, status: 400, error: 'reply_to_not_found' });
	const pending: PendingChatSend = { current: null };

	const sent = await postChatMessage(input, options(pending));

	assert.deepEqual(sent, { ok: false, reason: 'rejected', error: 'reply_to_not_found' });
	assert.deepEqual(calls, ['persist', 'request', 'clear']);
	assert.deepEqual(
		persisted.map((value) => value?.key ?? null),
		[KEY_A, null],
	);
	assert.equal(pending.current, null);
});

test('sends only after the key is stored and can send again afterwards', async () => {
	reset({ ok: true, data: { message: validMessage, warning: null } });
	const pending: PendingChatSend = { current: null };
	let allowPersistence = false;
	const deps = options(pending, (value) => {
		calls.push(value ? 'persist' : 'clear');
		persisted.push(value);
		return allowPersistence;
	});

	const first = await postChatMessage(input, deps);
	assert.deepEqual(first, { ok: false, reason: 'key_unavailable' });
	assert.deepEqual(calls, ['persist']);
	assert.equal(pending.current, null);

	allowPersistence = true;
	reset({ ok: true, data: { message: validMessage, warning: null } });
	const retry = await postChatMessage(input, deps);

	assert.equal(retry.ok, true);
	assert.deepEqual(requestKeys, [KEY_A]);
	assert.deepEqual(calls, ['persist', 'request', 'clear']);
	assert.equal(pending.current, null);
});

test('a storage error on a changed payload does not discard an earlier unsafe key', async () => {
	reset({ ok: false, status: 0, error: 'network_error' });
	const pending: PendingChatSend = {
		current: {
			fingerprint: JSON.stringify(input),
			key: KEY_OLD,
			createdAtMs: Date.now(),
		},
	};
	let allowPersistence = false;
	const deps = options(pending, (value) => {
		calls.push(value ? 'persist' : 'clear');
		persisted.push(value);
		return allowPersistence;
	});

	const changed = await postChatMessage({ ...input, body: 'Geändert' }, deps);
	assert.deepEqual(changed, { ok: false, reason: 'key_unavailable' });
	assert.equal(pending.current?.key, KEY_OLD);
	assert.deepEqual(requestKeys, []);

	allowPersistence = true;
	reset({ ok: false, status: 0, error: 'network_error' });
	await postChatMessage(input, deps);
	assert.deepEqual(requestKeys, [KEY_OLD]);
	assert.equal(pending.current?.fingerprint, JSON.stringify(input));
});

test('does not send with an invalid freshly generated UUID key', async () => {
	reset({ ok: true, data: { message: validMessage, warning: null } });
	const pending: PendingChatSend = { current: null };

	const sent = await postChatMessage(input, {
		...options(pending),
		createKey: () => 'kein-uuid',
	});

	assert.deepEqual(sent, { ok: false, reason: 'key_unavailable' });
	assert.deepEqual(calls, []);
	assert.equal(pending.current, null);
});

test('a malformed success response keeps the key for the retry', async () => {
	const malformed = [
		{},
		{ message: { ...validMessage, id: '' }, warning: null },
		{ message: { ...validMessage, createdAt: 'kein Datum' }, warning: null },
	];
	for (const data of malformed) {
		reset({ ok: true, data });
		const pending: PendingChatSend = { current: null };

		const sent = await postChatMessage(input, options(pending));

		assert.deepEqual(sent, { ok: false, reason: 'rejected', error: INVALID_RESPONSE_CODE });
		assert.deepEqual(calls, ['persist', 'request']);
		assert.equal(pending.current?.key, KEY_A);
		assert.equal(pending.current?.fingerprint, JSON.stringify(input));
	}
});

test('refuses an identical send with an expired, unclear or invalid pending key', async () => {
	for (const { key, createdAtMs } of [
		{ key: KEY_OLD, createdAtMs: null },
		{ key: KEY_OLD, createdAtMs: Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1 },
		{ key: 'kein-uuid', createdAtMs: Date.now() },
	]) {
		reset({ ok: true, data: { message: validMessage, warning: null } });
		const pending: PendingChatSend = {
			current: {
				fingerprint: JSON.stringify(input),
				key,
				createdAtMs,
			},
		};

		const sent = await postChatMessage(input, options(pending));

		assert.deepEqual(sent, { ok: false, reason: 'replay_expired' });
		assert.deepEqual(calls, []);
		assert.equal(pending.current?.key, key);
	}
});

test('a changed reply or mention gets a fresh key', async () => {
	const changedPayloads: ChatMessageInput[] = [
		{ ...input, replyToMessageId: '22222222-2222-4222-8222-222222222222' },
		{ ...input, mentionMemberIds: ['33333333-3333-4333-8333-333333333333'] },
	];
	for (const changed of changedPayloads) {
		reset({ ok: false, status: 0, error: 'network_error' });
		const pending: PendingChatSend = {
			current: {
				fingerprint: JSON.stringify(input),
				key: KEY_OLD,
				createdAtMs: Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1,
			},
		};

		await postChatMessage(changed, options(pending));

		assert.equal(requestKeys[0], KEY_A);
		assert.equal(pending.current?.fingerprint, JSON.stringify(changed));
		assert.equal(pending.current?.key, KEY_A);
		assert.equal(typeof pending.current?.createdAtMs, 'number');
	}
});
