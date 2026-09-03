#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCalibration, buildResult, canonical, validateSnapshot } from './index.mjs';
import { parseStudentCount, refreshSnapshot } from './refresh.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(directory, 'inputs/mana-wg.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
assert.deepEqual(validateSnapshot(fixture, fixture.snapshotDate), []);
assert.deepEqual(fixture.market.audienceSegments, [
	'students',
	'employed residents',
	'trainees',
	'international residents',
	'other shared households',
]);
const malformed = structuredClone(fixture);
malformed.channels[0].visitRate.source = undefined;
malformed.channels[0].creationRate.min = 1;
malformed.channels[0].creationRate.max = 0;
malformed.strategies[0].actions[0].command = 'echo forbidden';
const malformedErrors = validateSnapshot(malformed, fixture.snapshotDate);
assert.ok(malformedErrors.some((error) => error.includes('channels[0].visitRate.source')));
assert.ok(malformedErrors.some((error) => error.includes('channels[0].creationRate')));
assert.ok(malformedErrors.some((error) => error.includes('command')));

const options = { seed: 17, iterations: 40, maxMs: 10_000, asOf: fixture.snapshotDate };
const first = buildResult(fixture, options);
const second = buildResult(fixture, options);
assert.equal(canonical(first), canonical(second), 'seeded runs must be deterministic');
assert.deepEqual(first.horizons, [30, 90, 365, 1095]);
assert.deepEqual(first.audienceSegments, fixture.market.audienceSegments);
assert.equal(first.ranking.find((item) => item.id === 'paid-social-test')?.eligible, false);
assert.ok(first.freshness.staleSources.includes(fixture.market.wgShare.source));

const studentOnlyCap = structuredClone(fixture);
studentOnlyCap.market.students.min = 1;
studentOnlyCap.market.students.mode = 1;
studentOnlyCap.market.students.max = 1;
studentOnlyCap.market.maxActiveWgs.min = 100;
studentOnlyCap.market.maxActiveWgs.mode = 100;
studentOnlyCap.market.maxActiveWgs.max = 100;
const broadMarketResult = buildResult(studentOnlyCap, options);
assert.ok(
	broadMarketResult.strategies[0].scenarios.base.horizons[30].createdWgs.p50 > 1,
	'general WG capacity must not be constrained by student count',
);

const inactive = structuredClone(fixture);
inactive.funnel.membersPerCreatedWg.mode = 2;
inactive.funnel.actionsWithin7Days.mode = 1;
const inactiveResult = buildResult(inactive, options);
assert.equal(
	inactiveResult.strategies[0].scenarios.base.horizons[30].activatedWgs.p50,
	0,
	'unactivated WGs must not count',
);

const calibration = structuredClone(fixture);
calibration.calibration = [
	{
		path: 'funnel.activationProbability',
		value: 0.51,
		unit: 'fraction',
		measurementWindow: '2026-08-01/2026-09-01',
		sampleSize: 8,
		source: 'https://developers.google.com/webmaster-tools/v1/searchanalytics/query',
		observedAt: '2026-09-02',
	},
];
assert.equal(applyCalibration(calibration).funnel.activationProbability.evidence, 'observed');
assert.ok(
	validateSnapshot(
		{
			...fixture,
			calibration: [
				{
					path: 'funnel.activationProbability',
					value: 0.5,
					unit: 'fraction',
					measurementWindow: 'x',
					sampleSize: 1,
					source: 'https://example.com',
					observedAt: '2026-09-02',
					message: 'private',
				},
			],
		},
		fixture.snapshotDate,
	).some((error) => error.includes('message')),
);

assert.equal(
	parseStudentCount(Buffer.from('<p>insgesamt 2&nbsp;876&nbsp;900 Studierende</p>')),
	2876900,
);
const refreshed = refreshSnapshot(
	fixture,
	[
		{
			id: 'destatis-students',
			status: 'ok',
			httpStatus: 200,
			responseBytes: 123,
			responseSha256: 'hash',
			fetchedAt: '2026-09-03T00:00:00.000Z',
			extracted: { studentCount: 2876900 },
		},
	],
	'2026-09-03',
	'2026-09-03T00:00:00.000Z',
);
assert.equal(refreshed.snapshotDate, '2026-09-03');
assert.equal(refreshed.market.students.mode, 2876900);
assert.deepEqual(refreshed.market.audienceSegments, fixture.market.audienceSegments);
assert.equal(refreshed.sourceRefresh.updatedParameters[0], 'market.students.mode');
assert.equal(fixture.snapshotDate, '2026-09-02', 'refresh must not mutate baseline');
assert.throws(
	() =>
		refreshSnapshot(
			fixture,
			[{ id: 'destatis-students', status: 'ok' }],
			'2026-09-03',
			'2026-09-03T00:00:00.000Z',
		),
	(error) => error.code === 'SOURCE_UNPARSED',
);

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'manawg-growth-lab-'));
const cli = path.join(directory, 'index.mjs');
const command = [
	cli,
	'--input',
	fixturePath,
	'--out',
	outputDirectory,
	'--seed',
	'17',
	'--iterations',
	'40',
	'--max-ms',
	'10000',
	'--as-of',
	fixture.snapshotDate,
];
execFileSync(process.execPath, command, { stdio: 'pipe' });
const resultFile = fs
	.readdirSync(outputDirectory)
	.find((file) => file.endsWith('.json') && file !== 'last-success.json' && file !== 'index.jsonl');
assert.ok(resultFile, 'successful run must write JSON');
const firstBytes = fs.readFileSync(path.join(outputDirectory, resultFile));
execFileSync(process.execPath, command, { stdio: 'pipe' });
assert.deepEqual(
	fs.readFileSync(path.join(outputDirectory, resultFile)),
	firstBytes,
	'replay output must be byte-for-byte stable',
);
assert.match(
	fs.readFileSync(path.join(outputDirectory, resultFile.replace(/\.json$/, '.md')), 'utf8'),
	/Recommendations/,
);
assert.match(
	fs.readFileSync(path.join(outputDirectory, resultFile.replace(/\.json$/, '.md')), 'utf8'),
	/Audience: students, employed residents, trainees, international residents, other shared households/,
);
fs.rmSync(outputDirectory, { recursive: true, force: true });
process.stdout.write('growth-lab self-check passed\n');
