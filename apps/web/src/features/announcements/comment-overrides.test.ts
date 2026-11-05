import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommentOverrides } from './comment-overrides';
import type { Announcement, AnnouncementComment } from './components/announcement-types';

const { applyCommentOverrides, forgetCommentOverride, rememberCommentOverride } = await import(
	'./comment-overrides'
);

const comment = (id: string, content: string): AnnouncementComment => ({
	id,
	announcementId: 'a1',
	memberId: 'm1',
	content,
	createdAt: '2026-11-01T10:00:00.000Z',
	authorName: 'Abu',
	authorColor: null,
});
const post = (comments: AnnouncementComment[]) =>
	({ id: 'a1', comments }) as unknown as Announcement;

test('without overrides the post comes back as the same object', () => {
	const store: CommentOverrides = new Map();
	const item = post([comment('c1', 'Hallo')]);
	assert.equal(applyCommentOverrides(store, item), item);
	rememberCommentOverride(store, 'other', 'c1', null);
	assert.equal(applyCommentOverrides(store, item), item);
});

test('an unconfirmed edit stays until the server shows the same text', () => {
	const store: CommentOverrides = new Map();
	const edited = comment('c1', 'Neu');
	rememberCommentOverride(store, 'a1', 'c1', edited);
	const stale = post([comment('c1', 'Alt'), comment('c2', 'Zwei')]);
	assert.deepEqual(applyCommentOverrides(store, stale).comments, [edited, stale.comments[1]]);
	const fresh = post([comment('c1', 'Neu'), comment('c2', 'Zwei')]);
	assert.equal(applyCommentOverrides(store, fresh), fresh);
	assert.equal(store.size, 0);
});

test('a deleted comment stays hidden until the server drops it too', () => {
	const store: CommentOverrides = new Map();
	rememberCommentOverride(store, 'a1', 'c1', null);
	const stale = post([comment('c1', 'Weg'), comment('c2', 'Bleibt')]);
	assert.deepEqual(
		applyCommentOverrides(store, stale).comments.map((c) => c.id),
		['c2'],
	);
	assert.equal(store.get('a1')?.has('c1'), true);
	const fresh = post([comment('c2', 'Bleibt')]);
	assert.equal(applyCommentOverrides(store, fresh), fresh);
	assert.equal(store.size, 0);
});

test('a new comment not yet on the server is appended and kept', () => {
	const store: CommentOverrides = new Map();
	const draft = comment('tmp-1', 'Gleich da');
	rememberCommentOverride(store, 'a1', 'tmp-1', draft);
	const item = post([comment('c1', 'Erster')]);
	assert.deepEqual(applyCommentOverrides(store, item).comments, [item.comments[0], draft]);
	assert.equal(store.get('a1')?.get('tmp-1'), draft);
});

test('forgetting the last override of a post removes the post entry', () => {
	const store: CommentOverrides = new Map();
	rememberCommentOverride(store, 'a1', 'c1', null);
	rememberCommentOverride(store, 'a1', 'c2', null);
	assert.deepEqual([...(store.get('a1')?.keys() ?? [])], ['c1', 'c2']);
	forgetCommentOverride(store, 'a1', 'c1');
	assert.deepEqual([...(store.get('a1')?.keys() ?? [])], ['c2']);
	forgetCommentOverride(store, 'a1', 'c2');
	assert.equal(store.has('a1'), false);
	forgetCommentOverride(store, 'missing', 'c1');
	assert.equal(store.size, 0);
});
