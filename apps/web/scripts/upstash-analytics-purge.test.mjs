import assert from 'node:assert/strict';
import test from 'node:test';
import { fingerprintMetadata, runBoundedPurge, safeErrorCode } from './upstash-analytics-purge.mjs';

const scanStart = Date.parse('2026-09-30T12:24:23.073Z');

function makeRecords(overrides = {}) {
	const rows = [
		{ key: `manawg:limiter-a:events:${scanStart - 3_600_000}`, type: 'zset', ttl: -1, zcard: 3 },
		{ key: `manawg:limiter-b:events:${scanStart - 1_800_000}`, type: 'zset', ttl: -1, zcard: 4 },
	];
	return rows.map((row) => ({ ...row, ...(overrides[row.key] ?? {}) }));
}

function makeBaseline(records = makeRecords()) {
	return {
		namespacePattern: 'manawg:*:events:*',
		scanStartedAt: new Date(scanStart).toISOString(),
		scanStartMs: scanStart,
		maxKeys: 2,
		keyCount: records.length,
		keyMetadataFingerprintSha256: fingerprintMetadata(records),
		typeCounts: { zset: records.length },
		ttlSecondsCounts: { '-1': records.length },
		zsetCardinalitySum: records.reduce((sum, row) => sum + row.zcard, 0),
		oldestBucketMs: scanStart - 3_600_000,
		newestBucketMs: scanStart - 1_800_000,
		confirmationLiteral: 'DELETE_TEST_ANALYTICS_KEYS',
	};
}

function fakeRedis(initialRecords = makeRecords(), { onScan, onRead } = {}) {
	let scanNumber = 0;
	let readNumber = 0;
	const deleteCalls = [];
	const records = new Map(initialRecords.map((row) => [row.key, { ...row }]));
	return {
		deleteCalls,
		async scan(cursor, pattern) {
			assert.equal(pattern, 'manawg:*:events:*');
			assert.equal(String(cursor), '0');
			const selected = onScan ? onScan(++scanNumber, [...records.values()]) : [...records.values()];
			for (const row of selected) if (!records.has(row.key)) records.set(row.key, { ...row });
			return ['0', selected.map((row) => row.key)];
		},
		async type(key) {
			const row = records.get(key);
			const change = onRead?.('type', ++readNumber, key, row);
			return change?.type ?? row?.type ?? 'none';
		},
		async ttl(key) {
			const row = records.get(key);
			const change = onRead?.('ttl', readNumber, key, row);
			return change?.ttl ?? row?.ttl ?? -2;
		},
		async zcard(key) {
			const row = records.get(key);
			return row?.zcard ?? 0;
		},
		async del(keys) {
			deleteCalls.push([...keys]);
			return keys.length;
		},
	};
}

test('default dry run reports a bounded plan and never deletes', async () => {
	const records = makeRecords();
	const redis = fakeRedis(records);
	const summary = await runBoundedPurge({ redis, baseline: makeBaseline(records) });

	assert.equal(summary.mode, 'DRY_RUN');
	assert.equal(summary.candidateCount, 2);
	assert.equal(summary.deletedCount, 0);
	assert.equal(redis.deleteCalls.length, 0);
	for (const row of records) assert.equal(JSON.stringify(summary).includes(row.key), false);
});

test('execution without the exact confirmation literal never deletes', async () => {
	const records = makeRecords();
	const redis = fakeRedis(records);
	await assert.rejects(
		runBoundedPurge({ redis, baseline: makeBaseline(records), execute: true, confirmation: 'yes' }),
		/explicit_confirmation_required/,
	);
	assert.equal(redis.deleteCalls.length, 0);
});

test('foreign and limiter-counter keys abort before any deletion', async () => {
	const records = makeRecords();
	const foreign = { key: 'manawg:wg-write:member-x:limit', type: 'string', ttl: -1, zcard: 0 };
	const redis = fakeRedis(records, { onScan: () => [...records, foreign] });
	await assert.rejects(
		runBoundedPurge({ redis, baseline: makeBaseline(records), execute: true, confirmation: 'DELETE_TEST_ANALYTICS_KEYS' }),
		/foreign_namespace_or_schema_drift/,
	);
	assert.equal(redis.deleteCalls.length, 0);
});

test('an empty limiter namespace fails closed before metadata reads or deletion', async () => {
	const malformed = [{ key: `manawg::events:${scanStart - 1}`, type: 'zset', ttl: -1, zcard: 1 }];
	const redis = fakeRedis(malformed);
	await assert.rejects(
		runBoundedPurge({ redis, baseline: makeBaseline(makeRecords()) }),
		/foreign_namespace_or_schema_drift/,
	);
	assert.equal(redis.deleteCalls.length, 0);
});

test('a new bucket on the final scan aborts before any deletion', async () => {
	const records = makeRecords();
	const newer = { key: `manawg:limiter-c:events:${scanStart + 1}`, type: 'zset', ttl: -1, zcard: 1 };
	const redis = fakeRedis(records, { onScan: (n) => n === 1 ? records : [...records, newer] });
	await assert.rejects(
		runBoundedPurge({ redis, baseline: makeBaseline(records), execute: true, confirmation: 'DELETE_TEST_ANALYTICS_KEYS' }),
		/bucket_after_recorded_scan_start/,
	);
	assert.equal(redis.deleteCalls.length, 0);
});

test('a same-count replacement key fails the exact fingerprint before deletion', async () => {
	const records = makeRecords();
	const replacements = records.map((row, index) => index === 0
		? { ...row, key: row.key.replace('limiter-a', 'new-limiter') }
		: row);
	const redis = fakeRedis(records, { onScan: (n) => n === 1 ? records : replacements });
	await assert.rejects(
		runBoundedPurge({ redis, baseline: makeBaseline(records), execute: true, confirmation: 'DELETE_TEST_ANALYTICS_KEYS' }),
		/metadata_fingerprint_drift/,
	);
	assert.equal(redis.deleteCalls.length, 0);
});

test('type drift during final recheck aborts before any deletion', async () => {
	const records = makeRecords();
	let typeReads = 0;
	const redis = fakeRedis(records, {
			onRead: (kind, n, key, row) => {
			if (kind === 'type' && key === records[0].key && ++typeReads > 1) return { type: 'string' };
			return row;
		},
	});
	await assert.rejects(
		runBoundedPurge({ redis, baseline: makeBaseline(records), execute: true, confirmation: 'DELETE_TEST_ANALYTICS_KEYS' }),
		/type_schema_drift/,
	);
	assert.equal(redis.deleteCalls.length, 0);
});

test('TTL drift during final recheck aborts before any deletion', async () => {
	const records = makeRecords();
	let ttlReads = 0;
	const redis = fakeRedis(records, {
			onRead: (kind, n, key, row) => {
			if (kind === 'ttl' && key === records[0].key && ++ttlReads > 1) return { ttl: 120 };
			return row;
		},
	});
	await assert.rejects(
		runBoundedPurge({ redis, baseline: makeBaseline(records), execute: true, confirmation: 'DELETE_TEST_ANALYTICS_KEYS' }),
		/ttl_schema_drift/,
	);
	assert.equal(redis.deleteCalls.length, 0);
});

test('confirmed execution deletes only the exact preflight analytics key set', async () => {
	const records = makeRecords();
	const redis = fakeRedis(records);
	const summary = await runBoundedPurge({
		redis,
		baseline: makeBaseline(records),
		execute: true,
		confirmation: 'DELETE_TEST_ANALYTICS_KEYS',
	});

	assert.equal(summary.mode, 'EXECUTED');
	assert.equal(summary.deletedCount, 2);
	assert.deepEqual(redis.deleteCalls, [records.map((row) => row.key)]);
	assert.equal(redis.deleteCalls[0].some((key) => key.includes('wg-write') || key.includes('limiter-counter')), false);
});

test('untrusted connection errors are reduced to a generic safe label', () => {
	const label = safeErrorCode(new Error('REDIS_URL=rediss://default:private-secret@example.invalid:6379'));
	assert.equal(label, 'metadata_scan_failed');
	assert.equal(label.includes('private-secret'), false);
});
