import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkFloor, countSkipped } from '../scripts/check-coverage-floor.mjs';

// The coverage gate of the Database workflow (scripts/check-coverage-floor.mjs): a log line
// must not hide a skip, and a matching file without a coverage record must not pass.

/** Real TAP from the Node test runner for a test file with the given body. */
function tapOf(body: string) {
	const dir = mkdtempSync(join(tmpdir(), 'coverage-floor-'));
	const file = join(dir, 'case.test.mjs');
	writeFileSync(file, `import { test } from 'node:test';\n${body}\n`);
	// Without NODE_TEST_CONTEXT the child reports to stdout instead of to this runner.
	const { NODE_TEST_CONTEXT: _, ...env } = process.env;
	const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
		encoding: 'utf8',
		env,
	});
	return run.stdout;
}

const lcov = (file: string) => `SF:${file}\nLF:10\nLH:10\nBRF:2\nBRH:2\nend_of_record\n`;
const noSkip = tapOf(`test('runs', () => {});`);

test('a log line that looks like the skip summary does not hide a skipped test', () => {
	const tap = tapOf(
		`test('logs', () => { console.log('skipped 0'); });\ntest('skips # SKIP', { skip: 'no db' }, () => {});`,
	);
	assert.match(tap, /^# skipped 0$/m, 'the log line reaches the TAP report as "# skipped 0"');
	assert.deepEqual(countSkipped(tap), { points: 1 });
	const { failures } = checkFloor({ lcov: '', tap, sources: [], floors: {} });
	assert.deepEqual(failures, ['1 test(s) skipped, see "# SKIP" in the TAP report']);
	assert.deepEqual(checkFloor({ lcov: '', tap: noSkip, sources: [], floors: {} }).failures, []);
});

test('a summary that disagrees with the test points or is missing fails', () => {
	assert.match(countSkipped(`ok 1 - a # SKIP x\n# skipped 0\n`).error ?? '', /summary says 0/);
	assert.match(countSkipped('ok 1 - a\n').error ?? '', /no "# skipped" summary/);
});

test('a matching source file that no test imports counts as 0 % instead of passing', () => {
	const covered = 'src/features/expenses/server/settle-debt.ts';
	const unimported = 'src/features/expenses/server/settle-later.ts';
	const { report, failures } = checkFloor({
		lcov: lcov(covered),
		tap: noSkip,
		sources: [covered, unimported, 'src/core/other.ts', 'src/features/settle-x.test.ts'],
		floors: {},
	});
	assert.equal(report.length, 2);
	assert.deepEqual(failures, [
		`${unimported}: lines 0.00 % < 80 %`,
		`${unimported}: branches 0.00 % < 80 %`,
	]);
});

test('names are matched case-sensitively and a floor for a missing file fails', () => {
	const { report, failures } = checkFloor({
		lcov: '',
		tap: noSkip,
		sources: ['src/components/wg/InviteButton.tsx'],
		floors: { 'src/core/db/gone-invites.ts': { lines: 50, branches: 50 } },
	});
	assert.deepEqual(report, []);
	assert.deepEqual(failures, [
		'src/core/db/gone-invites.ts: has a floor but no such file, rename the entry',
	]);
});
