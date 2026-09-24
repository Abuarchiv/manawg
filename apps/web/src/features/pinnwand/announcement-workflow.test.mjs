import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcilePendingAnnouncements } from './announcement-workflow.ts';

test('tracks A to A+B to A across focus and background revisions before apply', () => {
	const postA = { id: 'post-a' };
	const postB = { id: 'post-b' };

	const firstFocus = reconcilePendingAnnouncements([postA], [postA, postB], 2, 1);
	assert.deepEqual(firstFocus, { items: [postA, postB], count: 1, serverRevision: 2 });

	const duplicateBackgroundResult = reconcilePendingAnnouncements([postA], [postA, postB], 2, 2);
	assert.equal(duplicateBackgroundResult, null);

	const secondBackground = reconcilePendingAnnouncements([postA], [postA], 3, 2);
	assert.deepEqual(secondBackground, { items: [postA], count: 0, serverRevision: 3 });
});
