import assert from 'node:assert/strict';
import test from 'node:test';

const { isLongAnnouncementBody, pickReactionOptions } = await import('./announcement-card-model');

test('a post is long past 300 characters or six lines', () => {
	assert.equal(isLongAnnouncementBody('a'.repeat(300)), false);
	assert.equal(isLongAnnouncementBody('a'.repeat(301)), true);
	assert.equal(isLongAnnouncementBody(Array(6).fill('x').join('\n')), false);
	assert.equal(isLongAnnouncementBody(Array(7).fill('x').join('\n')), true);
});

const post = (over: Partial<Parameters<typeof pickReactionOptions>[0]> = {}) => ({
	kind: 'info' as const,
	status: 'open' as const,
	myReactions: [],
	reactionCounts: {},
	...over,
});

test('the card shows the primary reaction of the kind, the rest goes to the menu', () => {
	assert.deepEqual(pickReactionOptions(post(), []), { visible: ['seen'], hidden: ['take', 'ok'] });
	assert.deepEqual(pickReactionOptions(post({ kind: 'problem' }), []).visible, ['take']);
	assert.deepEqual(pickReactionOptions(post({ kind: 'decision' }), []).visible, ['ok']);
});

test('used, own and just-touched reactions stay on the card', () => {
	assert.deepEqual(pickReactionOptions(post({ reactionCounts: { ok: 1 } } as never), []).visible, [
		'seen',
		'ok',
	]);
	assert.deepEqual(pickReactionOptions(post({ myReactions: ['take'] } as never), []).visible, [
		'seen',
		'take',
	]);
	assert.deepEqual(pickReactionOptions(post(), ['ok']).visible, ['seen', 'ok']);
	assert.deepEqual(pickReactionOptions(post({ reactionCounts: { ok: 0 } } as never), []).visible, [
		'seen',
	]);
});

test('a resolved post can no longer be taken', () => {
	const resolved = pickReactionOptions(post({ kind: 'request', status: 'resolved' } as never), []);
	assert.deepEqual(resolved, { visible: [], hidden: ['seen', 'ok'] });
	const open = pickReactionOptions(post({ kind: 'request' }), []);
	assert.deepEqual(open.visible, ['take']);
});
