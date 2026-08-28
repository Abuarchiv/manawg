import { describe, expect, it } from 'vitest';
import { mergePagedMessagesById, mergePagedReactions } from './chat-pure';

describe('mergePagedMessagesById', () => {
	it('returns existing when older is empty', () => {
		const existing = [{ id: '1' }, { id: '2' }];
		expect(mergePagedMessagesById([], existing)).toEqual(existing);
	});

	it('prepends older messages that are not already present', () => {
		const existing = [{ id: '3' }, { id: '4' }];
		const older = [{ id: '1' }, { id: '2' }];
		expect(mergePagedMessagesById(older, existing)).toEqual([
			{ id: '1' },
			{ id: '2' },
			{ id: '3' },
			{ id: '4' },
		]);
	});

	it('filters out duplicates on overlapping pages', () => {
		const existing = [{ id: '3' }, { id: '4' }];
		const older = [{ id: '2' }, { id: '3' }];
		expect(mergePagedMessagesById(older, existing)).toEqual([
			{ id: '2' },
			{ id: '3' },
			{ id: '4' },
		]);
	});
});

describe('mergePagedReactions', () => {
	it('dedupes by composite messageId|memberId|emoji key', () => {
		const existing = [{ messageId: 'm1', memberId: 'me', emoji: '👍' }];
		const older = [
			{ messageId: 'm1', memberId: 'me', emoji: '👍' },
			{ messageId: 'm1', memberId: 'me', emoji: '❤️' },
		];
		expect(mergePagedReactions(older, existing)).toEqual([
			{ messageId: 'm1', memberId: 'me', emoji: '❤️' },
			{ messageId: 'm1', memberId: 'me', emoji: '👍' },
		]);
	});

	it('returns existing when older is empty', () => {
		const existing = [{ messageId: 'm1', memberId: 'me', emoji: '👍' }];
		expect(mergePagedReactions([], existing)).toEqual(existing);
	});
});
