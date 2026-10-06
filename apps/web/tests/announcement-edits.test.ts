import assert from 'node:assert/strict';
import test from 'node:test';

const { withReplacedComment, withRestoredFields, withToggledReaction } = await import(
	'../src/features/pinnwand/announcement-edits.ts'
);

const reactor = { memberId: 'me', name: 'Mina', color: null };
const card = {
	id: 'a1',
	myReactions: [],
	reactionCounts: { take: 1 },
	takers: [{ memberId: 'other', name: 'Ole', color: null }],
	comments: [
		{ id: 'c2', createdAt: '2026-10-02T10:00:00.000Z', content: 'second' },
		{ id: 'c1', createdAt: '2026-10-01T10:00:00.000Z', content: 'first' },
	],
	pinnedAt: null,
	status: 'open',
} as never;

test('taking a card adds the viewer as taker and counts the reaction', () => {
	const taken = withToggledReaction(card, 'take', false, reactor);
	assert.deepEqual(taken.myReactions, ['take']);
	assert.equal(taken.reactionCounts.take, 2);
	assert.deepEqual(
		taken.takers.map((taker: { memberId: string }) => taker.memberId),
		['other', 'me'],
	);
	const released = withToggledReaction(taken, 'take', true, reactor);
	assert.deepEqual(released.myReactions, []);
	assert.equal(released.reactionCounts.take, 1);
	assert.deepEqual(
		released.takers.map((taker: { memberId: string }) => taker.memberId),
		['other'],
	);
});

test('other reactions leave the takers alone and never count below zero', () => {
	const unseen = withToggledReaction(card, 'seen', true, reactor);
	assert.equal(unseen.reactionCounts.seen, 0);
	assert.equal(unseen.takers, (card as { takers: unknown }).takers);
});

test('a replaced comment keeps the thread in creation order; null removes it', () => {
	const edited = withReplacedComment(card, 'c1', {
		id: 'c1',
		createdAt: '2026-10-01T10:00:00.000Z',
		content: 'edited',
	} as never);
	assert.deepEqual(
		edited.comments.map((comment: { content: string }) => comment.content),
		['edited', 'second'],
	);
	assert.deepEqual(
		withReplacedComment(card, 'c2', null).comments.map((comment: { id: string }) => comment.id),
		['c1'],
	);
});

test('a rollback restores only the captured fields', () => {
	const before = card;
	const after = { ...(card as object), pinnedAt: '2026-10-03T00:00:00.000Z', status: 'resolved' };
	const restored = withRestoredFields(after as never, before, ['pinnedAt']);
	assert.equal(restored.pinnedAt, null);
	assert.equal(restored.status, 'resolved');
});
