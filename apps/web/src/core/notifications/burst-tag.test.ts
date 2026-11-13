import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BURST_WINDOW_MS, burstTag } from './burst-tag';

test('a burst tag names sender and window, so only the same sender in the same window replaces', () => {
	const t0 = 10 * BURST_WINDOW_MS;
	const same = burstTag('chat', 'wg', 'a', t0);
	assert.equal(burstTag('chat', 'wg', 'a', t0 + BURST_WINDOW_MS - 1), same);
	assert.notEqual(burstTag('chat', 'wg', 'a', t0 + BURST_WINDOW_MS), same);
	assert.notEqual(burstTag('chat', 'wg', 'b', t0), same);
	assert.notEqual(burstTag('shopping', 'wg', 'a', t0), same);
	assert.match(same, /^chat:/);
});
