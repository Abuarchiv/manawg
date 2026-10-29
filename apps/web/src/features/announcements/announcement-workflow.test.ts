import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getMyOpenAnnouncements,
	isAnnouncementArchived,
	reconcilePendingAnnouncements,
	sortBoardAnnouncements,
	summarizeAnnouncementReactions,
} from './announcement-workflow';

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
	const fresh = { ...base, createdAt: '2026-09-26T12:00:00Z' };
	assert.equal(isAnnouncementArchived({ ...fresh, myReactions: ['seen'] }, now), true);
	assert.equal(
		isAnnouncementArchived({ ...fresh, kind: 'decision', myReactions: ['ok'] }, now),
		true,
	);
	assert.equal(
		isAnnouncementArchived({ ...fresh, kind: 'question', myReactions: ['seen'] }, now),
		false,
	);
	assert.equal(
		isAnnouncementArchived({ ...fresh, pinnedAt: old, myReactions: ['seen'] }, now),
		false,
	);
	assert.equal(
		isAnnouncementArchived({ ...base, comments: [{ createdAt: '2026-09-25T12:00:00Z' }] }, now),
		false,
	);
	// A reply after my acknowledgement brings the post back; a reply before it does not.
	const acked = { ...fresh, myReactions: ['seen'], myAcknowledgedAt: '2026-09-26T13:00:00Z' };
	assert.equal(isAnnouncementArchived(acked, now), true);
	assert.equal(
		isAnnouncementArchived({ ...acked, comments: [{ createdAt: '2026-09-26T12:30:00Z' }] }, now),
		true,
	);
	assert.equal(
		isAnnouncementArchived({ ...acked, comments: [{ createdAt: '2026-09-26T14:00:00Z' }] }, now),
		false,
	);
	assert.equal(
		isAnnouncementArchived({ ...base, kind: 'problem', status: 'resolved', pinnedAt: old }, now),
		true,
	);
});

test('summarizes known reactions per announcement and marks my own', () => {
	const summary = summarizeAnnouncementReactions(
		[
			{ announcementId: 'a', memberId: 'me', reaction: 'take' },
			{ announcementId: 'a', memberId: 'bob', reaction: 'take' },
			{ announcementId: 'a', memberId: 'bob', reaction: 'seen' },
			{ announcementId: 'a', memberId: 'me', reaction: 'unknown' },
			{ announcementId: 'b', memberId: 'bob', reaction: 'ok' },
			{
				announcementId: 'c',
				memberId: 'me',
				reaction: 'seen',
				createdAt: '2026-09-26T13:00:00.000Z',
			},
		],
		'me',
	);
	assert.deepEqual(summary.get('a'), {
		reactionCounts: { take: 2, seen: 1 },
		myReactions: ['take'],
		myAcknowledgedAt: null,
	});
	assert.deepEqual(summary.get('b'), {
		reactionCounts: { ok: 1 },
		myReactions: [],
		myAcknowledgedAt: null,
	});
	assert.equal(summary.get('c')?.myAcknowledgedAt, '2026-09-26T13:00:00.000Z');
	assert.equal(
		summarizeAnnouncementReactions(
			[{ announcementId: 'a', memberId: 'me', reaction: 'ok' }],
			null,
		).get('a')?.myReactions.length,
		0,
	);
});

test('my open announcements are the unresolved ones I took', () => {
	const items = [
		{ id: '1', status: 'open', myReactions: ['take'] },
		{ id: '2', status: 'resolved', myReactions: ['take'] },
		{ id: '3', status: 'open', myReactions: ['seen'] },
	];
	assert.deepEqual(
		getMyOpenAnnouncements(items).map((item) => item.id),
		['1'],
	);
});

test('orders the board pinned first, then newest first, like the server', () => {
	const a = { id: 'a', pinnedAt: null, createdAt: '2026-09-27T10:00:00Z' };
	const b = { id: 'b', pinnedAt: null, createdAt: '2026-09-27T11:00:00Z' };
	const c = { id: 'c', pinnedAt: '2026-09-27T12:00:00Z', createdAt: '2026-09-20T10:00:00Z' };
	const d = { id: 'd', pinnedAt: '2026-09-27T13:00:00Z', createdAt: '2026-09-21T10:00:00Z' };

	assert.deepEqual(
		sortBoardAnnouncements([a, b, c, d]).map((item) => item.id),
		['d', 'c', 'b', 'a'],
	);
	assert.deepEqual(
		sortBoardAnnouncements([{ ...d, pinnedAt: null }, c, b, a]).map((item) => item.id),
		['c', 'b', 'a', 'd'],
	);
});
