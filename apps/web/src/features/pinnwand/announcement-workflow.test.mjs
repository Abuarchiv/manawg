import assert from 'node:assert/strict';
import test from 'node:test';
import { isAnnouncementArchived, reconcilePendingAnnouncements } from './announcement-workflow.ts';

test('tracks A to A+B to A across focus and background revisions before apply', () => {
	const postA = { id: 'post-a' };
	const postB = { id: 'post-b' };

	const firstFocus = reconcilePendingAnnouncements([postA], [postA, postB], 2, 1);
	assert.deepEqual(firstFocus, { items: [postA, postB], count: 1, serverRevision: 2 });

	const duplicateBackgroundResult = reconcilePendingAnnouncements([postA], [postA, postB], 2, 2);
	assert.equal(duplicateBackgroundResult, null);

	const secondBackground = reconcilePendingAnnouncements([postA], [postA], 3, 2);
	assert.deepEqual(secondBackground, { items: [postA], count: 0, serverRevision: 3 });
});

test('archives resolved posts and quiet unpinned infos, keeps open asks on the board', () => {
	const now = Date.parse('2026-09-27T12:00:00Z');
	const old = '2026-09-10T12:00:00Z';
	const base = { kind: 'info', status: 'open', pinnedAt: null, createdAt: old, comments: [] };

	assert.equal(isAnnouncementArchived({ ...base, createdAt: '2026-09-26T12:00:00Z' }, now), false);
	assert.equal(isAnnouncementArchived(base, now), true);
	assert.equal(isAnnouncementArchived({ ...base, kind: 'decision' }, now), true);
	assert.equal(isAnnouncementArchived({ ...base, pinnedAt: old }, now), false);
	assert.equal(isAnnouncementArchived({ ...base, kind: 'question' }, now), false);
	assert.equal(
		isAnnouncementArchived({ ...base, comments: [{ createdAt: '2026-09-25T12:00:00Z' }] }, now),
		false,
	);
	assert.equal(
		isAnnouncementArchived({ ...base, kind: 'problem', status: 'resolved', pinnedAt: old }, now),
		true,
	);
});
