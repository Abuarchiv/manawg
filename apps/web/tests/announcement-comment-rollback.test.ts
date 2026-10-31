import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { CommentOverrides } from '../src/features/announcements/comment-overrides.ts';
import type {
	Announcement,
	AnnouncementComment,
} from '../src/features/announcements/components/announcement-types.ts';
import { deferred } from './support/deferred.ts';

type Reply =
	| { ok: true; data: { comment: AnnouncementComment } }
	| { ok: false; status: number; error: string };
let pendingRequest = {
	started: deferred<void>(),
	response: deferred<Reply>(),
};
function holdNextRequest(): void {
	pendingRequest = { started: deferred<void>(), response: deferred<Reply>() };
}

mock.module('react', {
	namedExports: { useRef: (current: unknown) => ({ current }) },
});
mock.module('@/core/infra/api-client', {
	namedExports: {
		apiFetch: async () => {
			pendingRequest.started.resolve();
			return pendingRequest.response.promise;
		},
	},
});
mock.module('@/shared/i18n/message', {
	namedExports: { useMessage: () => (message: unknown) => message },
});

const { useAnnouncementComments } = await import(
	'../src/features/announcements/hooks/use-announcement-comments.ts'
);
const { applyCommentOverrides, rememberCommentOverride } = await import(
	'../src/features/announcements/comment-overrides.ts'
);

const comment: AnnouncementComment = {
	id: 'comment-1',
	announcementId: 'announcement-1',
	memberId: 'member-1',
	content: 'old text',
	createdAt: '2026-10-31T00:00:00.000Z',
	authorName: 'M',
	authorColor: null,
};
const announcement: Announcement = {
	id: 'announcement-1',
	authorMemberId: 'member-1',
	content: 'Post',
	imageUrl: null,
	kind: 'info',
	status: 'open',
	source: 'manual',
	sourcePath: null,
	pinnedAt: null,
	resolvedAt: null,
	resolvedByMemberId: null,
	createdAt: '2026-10-31T00:00:00.000Z',
	updatedAt: '2026-10-31T00:00:00.000Z',
	reactionCounts: {},
	myReactions: [],
	takers: [],
	comments: [comment],
};

function createHarness(
	onLoad?: (
		itemsRef: { current: Announcement[] },
		commentOverridesRef: { current: CommentOverrides },
	) => void,
) {
	const itemsRef: { current: Announcement[] } = { current: [announcement] };
	const commentOverridesRef: { current: CommentOverrides } = { current: new Map() };
	// biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked for this synchronous hook harness.
	const actions = useAnnouncementComments(
		{
			wg: { id: 'wg-1', shareCode: 'ABCD2345' },
			identity: { memberId: 'member-1', name: 'M' },
			members: [],
			toast: { info() {}, success() {}, error() {} },
			encodedShareCode: 'ABCD2345',
			isPending: () => false,
			start() {},
			end() {},
			setActionError() {},
			setNotice() {},
			refreshCount() {},
			load: async () => onLoad?.(itemsRef, commentOverridesRef),
			itemsRef,
			commitItems(next: typeof itemsRef.current) {
				itemsRef.current = next;
			},
		},
		commentOverridesRef,
	);
	return { actions, itemsRef, commentOverridesRef };
}

test('a poll that acknowledges the edit must not be undone by its lost response', async () => {
	holdNextRequest();
	const { actions, itemsRef, commentOverridesRef } = createHarness();
	const update = actions.updateComment(announcement, comment.id, 'new text');
	await pendingRequest.started.promise;

	// The background server read sees the committed edit and acknowledges its exact override.
	itemsRef.current = [
		applyCommentOverrides(commentOverridesRef.current, {
			...announcement,
			comments: [{ ...comment, content: 'new text' }],
		}),
	];
	assert.equal(commentOverridesRef.current.has(announcement.id), false);

	pendingRequest.response.resolve({ ok: false, status: 0, error: 'network' });
	assert.equal(await update, false);
	assert.equal(itemsRef.current[0]?.comments[0]?.content, 'new text');
});

test('a failed older edit cannot clear a newer comment tombstone', async () => {
	holdNextRequest();
	const { actions, itemsRef, commentOverridesRef } = createHarness();
	const update = actions.updateComment(announcement, comment.id, 'new text');
	await pendingRequest.started.promise;

	// A newer confirmed delete arrives while the earlier PATCH is still pending.
	rememberCommentOverride(commentOverridesRef.current, announcement.id, comment.id, null);
	itemsRef.current = [{ ...announcement, comments: [] }];
	assert.deepEqual(itemsRef.current[0]?.comments, []);

	pendingRequest.response.resolve({ ok: false, status: 0, error: 'network' });
	assert.equal(await update, false);
	assert.deepEqual(itemsRef.current[0]?.comments, []);
	assert.equal(
		commentOverridesRef.current.get(announcement.id)?.get(comment.id),
		null,
		'the newer delete override survives the earlier request failure',
	);
});

test('a confirmed not-found response still removes the vanished comment', async () => {
	holdNextRequest();
	const { actions, itemsRef, commentOverridesRef } = createHarness();
	const update = actions.updateComment(announcement, comment.id, 'new text');
	await pendingRequest.started.promise;

	pendingRequest.response.resolve({ ok: false, status: 404, error: 'comment_not_found' });
	assert.equal(await update, true);
	assert.deepEqual(itemsRef.current[0]?.comments, []);
	assert.equal(commentOverridesRef.current.has(announcement.id), false);
});

test('a newer server delete is not undone by the confirmed edit override', async () => {
	holdNextRequest();
	const { actions, itemsRef, commentOverridesRef } = createHarness((itemsRef, overridesRef) => {
		itemsRef.current = [
			applyCommentOverrides(overridesRef.current, {
				...announcement,
				comments: [],
			}),
		];
	});
	pendingRequest.response.resolve({
		ok: true,
		data: { comment: { ...comment, content: 'new text' } },
	});

	assert.equal(await actions.updateComment(announcement, comment.id, 'new text'), true);
	assert.deepEqual(itemsRef.current[0]?.comments, []);
	assert.equal(commentOverridesRef.current.has(announcement.id), false);
});
