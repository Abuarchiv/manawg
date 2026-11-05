import assert from 'node:assert/strict';
import test from 'node:test';

const { detectMention, findMentions, splitMentions } = await import('./chat-text');

test('the mention picker opens after an @ at a word start, up to the cursor', () => {
	assert.deepEqual(detectMention('Hallo @Re', 9), { query: 'Re', startIndex: 6 });
	assert.deepEqual(detectMention('@René', 5), { query: 'René', startIndex: 0 });
	assert.deepEqual(detectMention('Hallo @Anna und', 11), { query: 'Anna', startIndex: 6 });
	assert.equal(detectMention('info@anna', 9), null);
	assert.equal(detectMention('Hallo @', 7), null);
	assert.equal(detectMention(`@${'a'.repeat(41)}`, 42), null);
	assert.deepEqual(detectMention(`@${'a'.repeat(40)}`, 41)?.startIndex, 0);
});

test('mentions match whole names only, with regex characters taken literally', () => {
	const names = ['Anna', 'J.R.', ''];
	assert.deepEqual(
		findMentions('@Annabell @Anna-Lena @Anna', names).map((m) => m.index),
		[21],
	);
	assert.deepEqual(
		findMentions('@JxRx und @J.R.', names).map((m) => m.text),
		['@J.R.'],
	);
	// An empty member name never turns a lone "@" into a mention.
	assert.deepEqual(findMentions('Mail mir @ später', names), []);
});

test('a message split into mentions keeps every character once and no empty text', () => {
	assert.deepEqual(splitMentions('@Anna hi', ['Anna']), [
		{ text: '@Anna', mention: 'Anna' },
		{ text: ' hi' },
	]);
	assert.deepEqual(splitMentions('', ['Anna']), [{ text: '' }]);
});
