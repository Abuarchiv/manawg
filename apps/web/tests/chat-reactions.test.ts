import assert from 'node:assert/strict';
import test from 'node:test';

const { summarizeReactions, withOwnReaction } = await import(
	'../src/features/chat/chat-reactions.ts'
);

test('reactions are counted per message and emoji, most used first, with the viewer marked', () => {
	const rows = [
		{ messageId: 'm1', memberId: 'a', emoji: '👍' },
		{ messageId: 'm1', memberId: 'b', emoji: '🔥' },
		{ messageId: 'm1', memberId: 'c', emoji: '🔥' },
		{ messageId: 'm2', memberId: 'a', emoji: '👍' },
	];
	const summary = summarizeReactions(rows, 'a');
	assert.deepEqual(summary.get('m1'), [
		{ emoji: '🔥', count: 2, mine: false },
		{ emoji: '👍', count: 1, mine: true },
	]);
	assert.deepEqual(summary.get('m2'), [{ emoji: '👍', count: 1, mine: true }]);
});

test('a confirmed own reaction is added once and removed only for the viewer', () => {
	const own = { messageId: 'm1', memberId: 'a', emoji: '👍' };
	const other = { messageId: 'm1', memberId: 'b', emoji: '👍' };
	const added = withOwnReaction([other], 'add', own);
	assert.deepEqual(added, [other, own]);
	assert.equal(withOwnReaction(added, 'add', own), added);
	assert.deepEqual(withOwnReaction(added, 'remove', own), [other]);
});
