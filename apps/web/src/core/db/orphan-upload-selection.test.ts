import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOrphanKeys } from './orphan-upload-selection';

const now = new Date('2026-10-20T12:00:00Z');
// The retention window is 14 days: an upload 14 days and one second old is orphan-eligible.
const old = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000 - 1000);
const fresh = new Date(now.getTime() - 60_000);

test('only old, unreferenced and unqueued pictures are orphans', () => {
	const objects = [
		{ key: 'old-orphan', createdAt: old },
		{ key: 'old-referenced', createdAt: old },
		{ key: 'old-queued', createdAt: old },
		{ key: 'fresh-orphan', createdAt: fresh },
	];
	assert.deepEqual(
		selectOrphanKeys(objects, new Set(['old-referenced']), new Set(['old-queued']), now),
		['old-orphan'],
	);
});
