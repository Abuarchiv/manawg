import { describe, expect, it } from 'vitest';

import {
	canDeleteMessage,
	canEditMessage,
	groupMessagesByDay,
	isSingleEmoji,
	parseMentions,
	previewBody,
	sanitizeMessageBody,
} from '@/lib/wg/chat-pure';

const MS_PER_MIN = 60_000;

describe('parseMentions', () => {
	it('extracts deduplicated names', () => {
		const result = parseMentions('Hi @Lena and @Max, also @Lena again');
		expect(result.mentions).toEqual(['Lena', 'Max']);
	});

	it('returns empty list for plain text', () => {
		expect(parseMentions('no mentions here').mentions).toEqual([]);
	});

	it('handles German umlauts and underscores', () => {
		expect(parseMentions('hi @Süßes_Kind').mentions).toEqual(['Süßes_Kind']);
	});

	it('does not match email-like substrings', () => {
		expect(parseMentions('mail me at user@example.com').mentions).toEqual([]);
	});

	it('handles non-string input', () => {
		// @ts-expect-error: testing runtime guard
		expect(parseMentions(null).mentions).toEqual([]);
	});

	it('trims body', () => {
		expect(parseMentions('  hello @Bob  ').cleanedBody).toBe('hello @Bob');
	});
});

describe('groupMessagesByDay', () => {
	it('groups messages by local day', () => {
		const groups = groupMessagesByDay([
			{ id: 'a', createdAt: '2026-05-23T08:00:00Z' },
			{ id: 'b', createdAt: '2026-05-23T18:00:00Z' },
			{ id: 'c', createdAt: '2026-05-24T08:00:00Z' },
		]);
		expect(groups).toHaveLength(2);
		expect(groups[0]?.messages).toHaveLength(2);
		expect(groups[1]?.messages).toHaveLength(1);
	});

	it('drops invalid timestamps', () => {
		const groups = groupMessagesByDay([
			{ id: 'a', createdAt: 'not-a-date' },
			{ id: 'b', createdAt: '2026-05-23T08:00:00Z' },
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.messages[0]?.id).toBe('b');
	});

	it('returns empty array for no messages', () => {
		expect(groupMessagesByDay([])).toEqual([]);
	});
});

describe('canEditMessage', () => {
	const baseMessage = {
		id: 'm1',
		senderMemberId: 'u1',
		kind: 'text',
		deletedAt: null,
		createdAt: new Date('2026-05-23T12:00:00Z'),
	};
	const member = { id: 'u1' };

	it('allows author within 15-min window', () => {
		expect(
			canEditMessage(baseMessage, member, baseMessage.createdAt.getTime() + 5 * MS_PER_MIN),
		).toBe(true);
	});

	it('rejects after window', () => {
		expect(
			canEditMessage(baseMessage, member, baseMessage.createdAt.getTime() + 16 * MS_PER_MIN),
		).toBe(false);
	});

	it('rejects non-author', () => {
		expect(canEditMessage(baseMessage, { id: 'u2' })).toBe(false);
	});

	it('rejects deleted message', () => {
		expect(canEditMessage({ ...baseMessage, deletedAt: new Date() }, member)).toBe(false);
	});

	it('rejects image messages', () => {
		expect(canEditMessage({ ...baseMessage, kind: 'image' }, member)).toBe(false);
	});

	it('rejects system messages', () => {
		expect(canEditMessage({ ...baseMessage, kind: 'system' }, member)).toBe(false);
	});
});

describe('canDeleteMessage', () => {
	const base = {
		id: 'm1',
		senderMemberId: 'u1',
		kind: 'text',
		deletedAt: null,
		createdAt: new Date(),
	};

	it('allows author', () => {
		expect(canDeleteMessage(base, { id: 'u1' })).toBe(true);
	});

	it('allows admin for other-member message', () => {
		expect(canDeleteMessage(base, { id: 'u2', role: 'admin' })).toBe(true);
	});

	it('rejects other non-admin member', () => {
		expect(canDeleteMessage(base, { id: 'u2' })).toBe(false);
	});

	it('rejects already-deleted', () => {
		expect(canDeleteMessage({ ...base, deletedAt: new Date() }, { id: 'u1' })).toBe(false);
	});

	it('requires admin to delete system messages', () => {
		expect(canDeleteMessage({ ...base, kind: 'system' }, { id: 'u1' })).toBe(false);
		expect(canDeleteMessage({ ...base, kind: 'system' }, { id: 'u1', role: 'admin' })).toBe(true);
	});
});

describe('isSingleEmoji', () => {
	it('accepts a single grapheme emoji', () => {
		expect(isSingleEmoji('🎉')).toBe(true);
		expect(isSingleEmoji('👍')).toBe(true);
	});

	it('rejects multiple emojis', () => {
		expect(isSingleEmoji('🎉🎉')).toBe(false);
	});

	it('rejects empty / whitespace', () => {
		expect(isSingleEmoji('')).toBe(false);
		expect(isSingleEmoji('   ')).toBe(false);
	});

	it('rejects non-string', () => {
		expect(isSingleEmoji(123)).toBe(false);
		expect(isSingleEmoji(null)).toBe(false);
	});
});

describe('sanitizeMessageBody', () => {
	it('trims and returns string', () => {
		expect(sanitizeMessageBody('  hi  ')).toBe('hi');
	});

	it('returns null for empty / whitespace', () => {
		expect(sanitizeMessageBody('   ')).toBeNull();
		expect(sanitizeMessageBody('')).toBeNull();
	});

	it('rejects bodies over max length instead of silently truncating', () => {
		expect(sanitizeMessageBody('abcdef', 3)).toBeNull();
	});

	it('returns null for non-string', () => {
		expect(sanitizeMessageBody(42)).toBeNull();
	});
});

describe('previewBody', () => {
	it('collapses whitespace', () => {
		expect(previewBody('hello\n\nworld')).toBe('hello world');
	});

	it('truncates with ellipsis', () => {
		const long = 'a'.repeat(200);
		const preview = previewBody(long, 10);
		expect(preview.endsWith('…')).toBe(true);
		expect(preview.length).toBe(10);
	});
});
