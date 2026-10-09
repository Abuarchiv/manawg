import assert from 'node:assert/strict';
import test from 'node:test';
import { ORPHAN_MIN_AGE_MS, selectOrphanKeys } from './orphan-upload-selection';

const now = new Date('2026-10-20T12:00:00Z');
const old = new Date(now.getTime() - ORPHAN_MIN_AGE_MS - 1000);
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
