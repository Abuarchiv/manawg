import { describe, expect, it } from 'vitest';
import {
	filterAnnouncements,
	getAnnouncementHash,
	getMyOpenAnnouncements,
	getNewAnnouncementCount,
	mergeBackgroundAnnouncements,
	summarizeAnnouncementReactions,
} from './announcement-workflow';

describe('getAnnouncementHash', () => {
	it('encodes announcement ids for URL hash navigation', () => {
		expect(getAnnouncementHash('pin/1?focus=comments')).toBe(
			'#announcement-pin%2F1%3Ffocus%3Dcomments',
		);
	});
});

describe('summarizeAnnouncementReactions', () => {
	it('counts reactions and marks the current members own reactions', () => {
		const summary = summarizeAnnouncementReactions(
			[
				{ announcementId: 'a1', memberId: 'm1', reaction: 'seen' },
				{ announcementId: 'a1', memberId: 'm2', reaction: 'seen' },
				{ announcementId: 'a1', memberId: 'm1', reaction: 'ok' },
				{ announcementId: 'a2', memberId: 'm1', reaction: 'take' },
			],
			'm1',
		);

		expect(summary.get('a1')).toEqual({
			reactionCounts: { seen: 2, ok: 1 },
			myReactions: ['seen', 'ok'],
		});
		expect(summary.get('a2')).toEqual({
			reactionCounts: { take: 1 },
			myReactions: ['take'],
		});
	});
});

describe('filterAnnouncements', () => {
	const items = [
		{
			id: 'a1',
			kind: 'info',
			status: 'open',
			pinnedAt: null,
			content: 'Wasserhahn tropft',
			takers: [{ memberId: 'm1', name: 'Mina', color: null }],
		},
		{
			id: 'a2',
			kind: 'problem',
			status: 'resolved',
			pinnedAt: '2026-05-18T10:00:00.000Z',
			content: 'Internet geht wieder',
			takers: [],
		},
		{
			id: 'a3',
			kind: 'request',
			status: 'open',
			pinnedAt: null,
			content: 'Bitte Müll runterbringen',
			takers: [],
		},
	] as const;

	it('filters by status, pinned state, and kind', () => {
		expect(filterAnnouncements(items, { status: 'open', kind: 'all', pinnedOnly: false })).toEqual([
			items[0],
			items[2],
		]);
		expect(filterAnnouncements(items, { status: 'all', kind: 'all', pinnedOnly: true })).toEqual([
			items[1],
		]);
		expect(
			filterAnnouncements(items, { status: 'all', kind: 'problem', pinnedOnly: false }),
		).toEqual([items[1]]);
	});

	it('filters by free-text search without losing other filters', () => {
		expect(
			filterAnnouncements(items, {
				status: 'open',
				kind: 'all',
				pinnedOnly: false,
				query: 'müll',
			}),
		).toEqual([items[2]]);
		expect(
			filterAnnouncements(items, {
				status: 'open',
				kind: 'all',
				pinnedOnly: false,
				query: 'internet',
			}),
		).toEqual([]);
	});

	it('filters by ownership responsibility', () => {
		expect(
			filterAnnouncements(items, {
				status: 'all',
				kind: 'all',
				pinnedOnly: false,
				ownership: 'mine',
				currentMemberId: 'm1',
			}),
		).toEqual([items[0]]);
		expect(
			filterAnnouncements(items, {
				status: 'open',
				kind: 'all',
				pinnedOnly: false,
				ownership: 'untaken',
				currentMemberId: 'm1',
			}),
		).toEqual([items[2]]);
	});
});

describe('getMyOpenAnnouncements', () => {
	it('returns unresolved posts where the member reacted with take', () => {
		const items = [
			{ id: 'a1', status: 'open', myReactions: ['take'] },
			{ id: 'a2', status: 'resolved', myReactions: ['take'] },
			{ id: 'a3', status: 'open', myReactions: ['seen'] },
		] as const;

		expect(getMyOpenAnnouncements(items)).toEqual([items[0]]);
	});
});

describe('getNewAnnouncementCount', () => {
	it('counts remote items missing from the current list', () => {
		expect(
			getNewAnnouncementCount(
				[{ id: 'a1' }, { id: 'a2' }],
				[{ id: 'a0' }, { id: 'a1' }, { id: 'a2' }],
			),
		).toBe(1);
	});
});

describe('mergeBackgroundAnnouncements', () => {
	it('refreshes fields on already-visible items from the remote copy', () => {
		const current = [
			{ id: 'a1', status: 'open' },
			{ id: 'a2', status: 'open' },
		];
		const remote = [
			{ id: 'a1', status: 'resolved' },
			{ id: 'a2', status: 'open' },
		];

		expect(mergeBackgroundAnnouncements(current, remote)).toEqual([
			{ id: 'a1', status: 'resolved' },
			{ id: 'a2', status: 'open' },
		]);
	});

	it('keeps the current order/length, never inserting brand-new remote items', () => {
		const current = [{ id: 'a1', status: 'open' }];
		const remote = [
			{ id: 'a0', status: 'open' },
			{ id: 'a1', status: 'resolved' },
		];

		expect(mergeBackgroundAnnouncements(current, remote)).toEqual([
			{ id: 'a1', status: 'resolved' },
		]);
	});

	it('leaves an item untouched when it is missing from the remote copy', () => {
		const current = [{ id: 'a1', status: 'open' }];
		expect(mergeBackgroundAnnouncements(current, [])).toEqual([{ id: 'a1', status: 'open' }]);
	});
});
