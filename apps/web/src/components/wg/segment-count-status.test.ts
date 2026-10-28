import assert from 'node:assert/strict';
import { test } from 'node:test';
import { segmentCountStatus } from './segment-count-status';

test('a missing count names the loading or unavailable state, never a number', () => {
	assert.deepEqual(
		segmentCountStatus({ count: undefined, state: 'loading' })?.values?.state,
		'loading',
	);
	assert.equal(
		segmentCountStatus({ count: undefined, state: 'unavailable' })?.values?.state,
		'unavailable',
	);
	assert.equal(segmentCountStatus({ count: undefined, state: 'ready' }), null);
});

test('an exact total wins over the overflow marker and a stale read is flagged', () => {
	const overflow = segmentCountStatus({
		count: 99,
		state: 'ready',
		overflow: true,
		hint: 'unread',
	});
	assert.deepEqual(overflow?.values, {
		state: 'ready',
		overflow: 'yes',
		count: 99,
		hint: 'unread',
		stale: 'no',
	});
	const exact = segmentCountStatus({ count: 99, state: 'stale', overflow: true, exactCount: 134 });
	assert.equal(exact?.values?.overflow, 'no');
	assert.equal(exact?.values?.count, 134);
	assert.equal(exact?.values?.stale, 'yes');
});
