import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canDeleteMessage,
	canEditMessage,
	chatDayLabel,
	countChatReaders,
	filterPersistedMentionIds,
	findFirstUnreadId,
	isSingleEmoji,
	reconcileChatMessages,
	sanitizeMessageBody,
} from './chat-pure';
import { extractLinks, findMentions, splitMentions } from './chat-text';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');

const de = serverRootT('de');
const en = serverRootT('en');

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

test('a mention of a longer name does not also mention the shorter prefix name', () => {
	const names = ['Anna', 'Anna Lena', 'René'];
	const mentioned = (body: string) => findMentions(body, names).map((m) => m.name);
	assert.deepEqual(mentioned('@Anna Lena hi'), ['Anna Lena']);
	assert.deepEqual(mentioned('@Anna hi'), ['Anna']);
	assert.deepEqual(mentioned('info@anna.de'), []);
	assert.deepEqual(mentioned('info@Anna.de'), []);
	assert.deepEqual(mentioned('(@Anna) und @René, ok'), ['Anna', 'René']);
	assert.deepEqual(mentioned('@Anna @Anna Lena'), ['Anna', 'Anna Lena']);
	assert.deepEqual(
		splitMentions('hi @Anna Lena!', names).map((s) => s.mention ?? null),
		[null, 'Anna Lena', null],
	);
	assert.deepEqual(splitMentions('no mention', names), [{ text: 'no mention' }]);
});

test('only real emoji count as a reaction', () => {
	for (const ok of ['👍', '❤️', '🇩🇪', '👨‍👩‍👧', '1️⃣']) assert.equal(isSingleEmoji(ok), true, ok);
	for (const bad of ['a', '7', '.', '', '  ', '👍👍', 42, null])
		assert.equal(isSingleEmoji(bad), false, String(bad));
});

test('extractLinks finds http(s) links and drops trailing punctuation', () => {
	assert.deepEqual(extractLinks('Siehe https://example.com/a?b=1, und (http://x.de/y).'), [
		'https://example.com/a?b=1',
		'http://x.de/y',
	]);
	assert.deepEqual(extractLinks('www.example.com javascript:alert(1)'), []);
	assert.deepEqual(extractLinks('https://a.de https://a.de'), ['https://a.de/']);
	assert.equal(extractLinks('https://a.de https://b.de https://c.de https://d.de').length, 3);
});

test('findFirstUnreadId points at the first foreign message after the read marker', () => {
	const msg = (id: string, minute: number, sender: string | null, extra = {}) => ({
		id,
		senderMemberId: sender,
		createdAt: new Date(Date.UTC(2026, 8, 23, 10, minute)).toISOString(),
		...extra,
	});
	const list = [msg('a', 0, 'bob'), msg('b', 1, 'me'), msg('c', 2, 'me'), msg('d', 3, 'bob')];
	const marker = { messageId: 'a', createdAt: list[0]?.createdAt ?? '' };
	assert.equal(findFirstUnreadId(list, marker, 'me'), 'd');
	assert.equal(findFirstUnreadId(list, null, 'me'), null);
	// Marker not loaded and older than the page: first foreign message of the page.
	const old = { messageId: 'zz', createdAt: '2026-09-01T00:00:00.000Z' };
	assert.equal(findFirstUnreadId(list, old, 'me'), 'a');
	// Only own messages after the marker: nothing unread.
	assert.equal(findFirstUnreadId(list.slice(0, 3), marker, 'me'), null);
	// Own system messages and deleted messages are skipped.
	const system = msg('s', 4, null, { systemPayload: { actorMemberId: 'me' } });
	const deleted = msg('x', 5, 'bob', { deletedAt: '2026-09-23T10:05:00.000Z' });
	assert.equal(findFirstUnreadId([...list.slice(0, 3), system, deleted], marker, 'me'), null);
});

test('day pills say today, yesterday, a weekday within the week, else the date', () => {
	const now = new Date(2026, 9, 9, 0, 30);
	const label = (day: Date, at = now, locale: 'de' | 'en' = 'de') =>
		renderMessage(locale === 'de' ? de : en, chatDayLabel(day, at, locale));
	assert.equal(label(new Date(2026, 9, 9)), 'Heute');
	assert.equal(label(new Date(2026, 9, 8)), 'Gestern');
	assert.equal(label(new Date(2026, 9, 5)), 'Montag');
	assert.equal(label(new Date(2026, 9, 2)), '2. Oktober');
	assert.equal(label(new Date(2025, 9, 2)), '2. Oktober 2025');
	// Across the DST switch (25 October 2026 in Germany) a day is still a day.
	assert.equal(label(new Date(2026, 9, 25), new Date(2026, 9, 26, 12)), 'Gestern');
});

test('day pills render English with the English date order', () => {
	const now = new Date(2026, 9, 9, 0, 30);
	const label = (day: Date) => renderMessage(en, chatDayLabel(day, now, 'en'));
	assert.equal(label(new Date(2026, 9, 9)), 'Today');
	assert.equal(label(new Date(2026, 9, 8)), 'Yesterday');
	assert.equal(label(new Date(2026, 9, 5)), 'Monday');
	assert.equal(label(new Date(2026, 9, 2)), '2 October');
	assert.equal(label(new Date(2025, 9, 2)), '2 October 2025');
});

test('read ticks count only the given readers who read up to the message', () => {
	const reads = [
		{ memberId: 'anna', lastReadAt: '2026-09-23T10:00:00.000Z' },
		{ memberId: 'ben', lastReadAt: '2026-09-23T09:59:59.000Z' },
		{ memberId: 'me', lastReadAt: '2026-09-23T11:00:00.000Z' },
	];
	assert.equal(countChatReaders(createdAt, reads, ['anna', 'ben']), 1);
	assert.equal(countChatReaders(createdAt, reads, ['anna', 'ben', 'cleo']), 1);
	assert.equal(countChatReaders('2026-09-23T09:00:00.000Z', reads, ['anna', 'ben']), 2);
	assert.equal(countChatReaders('kaputt', reads, ['anna']), 0);
});

test('message length counts emoji once, like the request schema', () => {
	assert.equal(sanitizeMessageBody('😀'.repeat(3000), 4000), '😀'.repeat(3000));
	assert.equal(sanitizeMessageBody('😀'.repeat(4001), 4000), null);
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
