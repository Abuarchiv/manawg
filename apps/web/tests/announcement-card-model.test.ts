import assert from 'node:assert/strict';
import test from 'node:test';

const { isLongAnnouncementBody, pickReactionOptions } = await import(
	'../src/features/pinnwand/announcement-card-model.ts'
);

const post = {
	kind: 'problem' as const,
	status: 'open' as const,
	myReactions: [] as Array<'seen' | 'take' | 'ok'>,
	reactionCounts: {},
};

test('a card shows the kind’s primary reaction and keeps the others in the menu', () => {
	assert.deepEqual(pickReactionOptions(post, []), { visible: ['take'], hidden: ['seen', 'ok'] });
	assert.deepEqual(pickReactionOptions({ ...post, kind: 'decision' }, []), {
		visible: ['ok'],
		hidden: ['seen', 'take'],
	});
});

test('used, own and just touched reactions stay on the card', () => {
	assert.deepEqual(
		pickReactionOptions({ ...post, reactionCounts: { seen: 2 }, myReactions: ['ok'] }, []).visible,
		['seen', 'take', 'ok'],
	);
	assert.deepEqual(pickReactionOptions(post, ['ok']).visible, ['take', 'ok']);
});

test('a resolved post cannot be taken any more', () => {
	assert.deepEqual(pickReactionOptions({ ...post, status: 'resolved' }, []), {
		visible: [],
		hidden: ['seen', 'ok'],
	});
});

test('long posts are collapsed by length or line count', () => {
	assert.equal(isLongAnnouncementBody('kurz'), false);
	assert.equal(isLongAnnouncementBody('x'.repeat(301)), true);
	assert.equal(isLongAnnouncementBody('a\nb\nc\nd\ne\nf\ng'), true);
});
