import assert from 'node:assert/strict';
import test from 'node:test';
import {
	advanceChatRefreshSequence,
	canDeleteMessage,
	canEditMessage,
	chatMessagesReadPayload,
	filterPersistedMentionIds,
	isLatestChatRefreshResponse,
	nextChatRefreshBatch,
	reactionKeysToPreserve,
	reconcileChatMessages,
	reconcileChatReactions,
	sanitizeChatMessageForRead,
} from './chat-pure';

const createdAt = '2026-09-23T10:00:00.000Z';
const own = { id: 'm1', senderMemberId: 'me', kind: 'text', createdAt };

test('only the sender can edit a live text message within the edit window', () => {
	const at = (minutes: number) => Date.parse(createdAt) + minutes * 60_000;
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

test('a full latest page past the loaded history replaces it instead of leaving a gap', () => {
	const page = (from: number, to: number) =>
		Array.from({ length: to - from + 1 }, (_, index) => ({ id: `m${from + index}` }));
	// Loaded m1..m60 before the tab went to the background; m61..m200 arrived.
	const loaded = page(1, 60);
	const latest = page(151, 200);
	assert.deepEqual(reconcileChatMessages(loaded, latest, [], 50), latest);

	// Overlapping or partial latest pages still merge into the loaded history.
	assert.deepEqual(
		reconcileChatMessages(loaded, page(41, 90), [], 50).map((m) => m.id),
		page(1, 90).map((m) => m.id),
	);
	assert.deepEqual(
		reconcileChatMessages(loaded, page(61, 70), [], 50).map((m) => m.id),
		page(1, 70).map((m) => m.id),
	);
	assert.deepEqual(reconcileChatMessages([], latest, [], 50), latest);
});

test('returns only mention IDs confirmed by the database insert', () => {
	assert.deepEqual(
		filterPersistedMentionIds(
			['member-a', 'member-b', 'member-c'],
			[{ mentionedMemberId: 'member-c' }, { mentionedMemberId: 'member-a' }],
		),
		['member-a', 'member-c'],
	);
});

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

	assert.deepEqual(sanitizeChatMessageForRead(deleted), {
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
		reconcileChatReactions(
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
		reactionKeysToPreserve(
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
	type Message = {
		id: string;
		createdAt: string;
		body: string | null;
		imageUrl: null;
		deletedAt: string | null;
	};
	const oldMessage: Message = {
		id: 'older-message',
		createdAt: '2026-09-23T10:00:00.000Z',
		body: 'deleted text must not remain visible',
		imageUrl: null,
		deletedAt: null,
	};
	const latestMessage: Message = {
		id: 'latest-message',
		createdAt: '2026-09-23T12:00:00.000Z',
		body: 'still visible',
		imageUrl: null,
		deletedAt: null,
	};
	const tombstone: Message = {
		...oldMessage,
		body: null,
		deletedAt: '2026-09-23T13:00:00.000Z',
	};

	assert.deepEqual(
		reconcileChatMessages([oldMessage, latestMessage], [latestMessage], [tombstone]),
		[tombstone, latestMessage],
	);
});

test('older message refresh batches are bounded and rotate through loaded IDs', () => {
	const loaded = Array.from({ length: 7 }, (_, index) => ({ id: `message-${index}` }));

	assert.deepEqual(nextChatRefreshBatch(loaded, 2, 3, 0), {
		ids: ['message-0', 'message-1', 'message-2'],
		nextOffset: 3,
	});
	assert.deepEqual(nextChatRefreshBatch(loaded, 2, 3, 3), {
		ids: ['message-3', 'message-4'],
		nextOffset: 0,
	});
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

	assert.deepEqual(chatMessagesReadPayload([pageTombstone], [olderTombstone]), {
		messages: [{ ...pageTombstone, body: null }],
		refreshedMessages: [{ ...olderTombstone, body: null }],
	});
	assert.deepEqual(chatMessagesReadPayload([], [olderTombstone]), {
		messages: [],
		refreshedMessages: [{ ...olderTombstone, body: null }],
	});
});

test('late older refresh response cannot overwrite a newer tombstone', () => {
	let latestRequestId = 0;
	const staleRequestId = ++latestRequestId;
	const tombstoneRequestId = ++latestRequestId;
	let visibleMessage = 'live body';

	if (isLatestChatRefreshResponse(tombstoneRequestId, latestRequestId)) {
		visibleMessage = 'tombstone';
	}
	if (isLatestChatRefreshResponse(staleRequestId, latestRequestId)) {
		visibleMessage = 'stale live body';
	}
	assert.equal(visibleMessage, 'tombstone');
});

test('GET started before successful delete cannot restore the deleted body', () => {
	let latestRequestId = 1;
	const oldGetRequestId = latestRequestId;
	let visibleBody: string | null = 'body to delete';

	latestRequestId = advanceChatRefreshSequence(latestRequestId) ?? latestRequestId;
	visibleBody = null;
	if (isLatestChatRefreshResponse(oldGetRequestId, latestRequestId)) {
		visibleBody = 'body to delete';
	}

	assert.equal(visibleBody, null);
});

test('reconciliation preserves database order when timestamps lose microseconds', () => {
	const older = {
		id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
		createdAt: new Date('2026-09-24T10:00:00.123100Z').toISOString(),
		body: 'older',
	};
	const newer = {
		id: '00000000-0000-4000-8000-000000000000',
		createdAt: new Date('2026-09-24T10:00:00.123900Z').toISOString(),
		body: 'newer',
	};
	const latest = { id: 'latest', createdAt: '2026-09-24T10:00:01.000Z', body: 'latest' };
	assert.deepEqual(reconcileChatMessages([], [older, newer], []), [older, newer]);
	// Refreshed rows are unordered by the API; they must only replace in place.
	const edited = { ...older, body: 'edited' };
	assert.deepEqual(reconcileChatMessages([older, newer, latest], [latest], [newer, edited]), [
		edited,
		newer,
		latest,
	]);
	assert.deepEqual(reconcileChatMessages([older, newer], [newer, latest], []), [
		older,
		newer,
		latest,
	]);
});
