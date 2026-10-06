import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectMention } from '../src/features/chat/chat-pure';

test('mention autocomplete does not open for an isolated at-sign', () => {
	assert.equal(detectMention('@', 1), null);
	assert.equal(detectMention('@ ', 1), null);
	assert.deepEqual(detectMention('Hallo @M', 8), { query: 'M', startIndex: 6 });
	// Names with non-ASCII letters stay selectable up to the end of the name.
	assert.deepEqual(detectMention('Hi @René', 8), { query: 'René', startIndex: 3 });
});
