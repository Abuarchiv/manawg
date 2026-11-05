import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatReactionRow } from './chat-types';

const { reactorNames, summarizeReactions, withOwnReaction } = await import('./chat-reactions');

const row = (messageId: string, memberId: string, emoji: string): ChatReactionRow => ({
	messageId,
	memberId,
	emoji,
});

test('reactions are grouped per message, most used emoji first, the viewer listed first', () => {
	const summary = summarizeReactions(
		[row('m1', 'ben', '👍'), row('m1', 'cem', '😂'), row('m1', 'me', '😂'), row('m2', 'ben', '😂')],
		'me',
	);
	assert.deepEqual(summary.get('m1'), [
		{ emoji: '😂', count: 2, mine: true, memberIds: ['me', 'cem'] },
		{ emoji: '👍', count: 1, mine: false, memberIds: ['ben'] },
	]);
	assert.deepEqual(summary.get('m2'), [{ emoji: '😂', count: 1, mine: false, memberIds: ['ben'] }]);
});

test('a confirmed own reaction is added once and removed without touching others', () => {
	const own = row('m1', 'me', '👍');
	const others = [row('m1', 'ben', '👍'), row('m1', 'me', '😂'), row('m2', 'me', '👍')];
	const added = withOwnReaction(others, 'add', own);
	assert.deepEqual(added, [...others, own]);
	assert.equal(withOwnReaction(added, 'add', own), added);
	assert.deepEqual(withOwnReaction(added, 'remove', own), others);
});

test('reactor names show the viewer as you and departed members as former', () => {
	const members = [
		{ id: 'me', name: 'Abu' },
		{ id: 'ben', name: 'Ben' },
	];
	const words = { you: 'Du', former: 'Ehemaliges Mitglied' };
	assert.equal(
		reactorNames(['me', 'ben', 'gone'], members, 'me', words),
		'Du, Ben, Ehemaliges Mitglied',
	);
});
