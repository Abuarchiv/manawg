import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
	validateArchiveEntry,
	verifyStorageCoverage,
} from '../../../.github/scripts/db-restore-probe.mjs';

test('restore archive accepts only the database dump and Storage tree', () => {
	assert.equal(validateArchiveEntry('database.dump'), 'database.dump');
	assert.equal(validateArchiveEntry('storage/'), 'storage/');
	assert.equal(validateArchiveEntry('storage/receipts/one.jpg'), 'storage/receipts/one.jpg');
	for (const entry of ['/tmp/dump', '../outside', 'storage/../../outside', 'unexpected.txt']) {
		assert.throws(() => validateArchiveEntry(entry));
	}
	assert.throws(() => validateArchiveEntry('storage/link', 'symlink'));
});

test('restored Storage rows match object files and recorded sizes', () => {
	const temp = mkdtempSync(path.join(tmpdir(), 'manawg-restore-probe-test-'));
	try {
		const storage = path.join(temp, 'storage');
		const objectPath = path.join(storage, 'receipts', '2026', 'one.jpg');
		mkdirSync(path.dirname(objectPath), { recursive: true });
		writeFileSync(objectPath, 'image');
		assert.deepEqual(
			verifyStorageCoverage([['receipts', '2026/one.jpg', '5']], storage),
			{ objectCount: 1, byteCount: 5, sizeChecked: 1 },
		);
		assert.throws(() => verifyStorageCoverage([['receipts', '../outside.jpg', '5']], storage));
		assert.throws(() => verifyStorageCoverage([['receipts', 'missing.jpg', '1']], storage));
		assert.throws(() => verifyStorageCoverage([['receipts', '2026/one.jpg', '4']], storage));
		assert.throws(() =>
			verifyStorageCoverage(
				[
					['receipts', '2026/one.jpg', '5'],
					['receipts', '2026/one.jpg', '5'],
				],
				storage,
			),
		);
		const outsideFile = path.join(temp, 'outside.jpg');
		writeFileSync(outsideFile, 'outside');
		symlinkSync(outsideFile, path.join(storage, 'receipts', 'linked.jpg'));
		assert.throws(() => verifyStorageCoverage([['receipts', 'linked.jpg', '7']], storage));
		writeFileSync(path.join(storage, 'unexpected.txt'), 'extra');
		assert.throws(() => verifyStorageCoverage([['receipts', '2026/one.jpg', '5']], storage));
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
