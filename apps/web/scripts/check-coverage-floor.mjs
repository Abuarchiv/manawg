#!/usr/bin/env node
/**
 * Coverage floor for the money and invite code, checked after the combined unit and database run
 * in the Database workflow:
 *
 *   node scripts/check-coverage-floor.mjs coverage/lcov.info coverage/tests.tap
 *
 * Every source file under src/ whose name matches PATTERNS counts, also one no test imports (it
 * has no LCOV record and counts as 0 %). Fails when such a file drops under its floor in FLOORS
 * (80 % for a file without an entry), when a floor names a missing file, or when a
 * test skipped itself (with TEST_DATABASE_URL set, nothing may skip silently). Skips are counted
 * from the TAP test points and must agree with the runner's final summary. Prints every file.
 *
 * The run writes coverage for all files and this script filters them: Node's own
 * --test-coverage-include stops dropping mock.module() stubs, which then overwrite the real
 * file's coverage.
 */

import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Case-sensitive on every platform (path.matchesGlob ignores case on macOS):
// src/**/settle*, src/**/*ledger*, src/**/expense-payments*, src/**/*invite*.
const PATTERNS = [
	/^src\/(?:.*\/)?settle[^/]*$/,
	/^src\/(?:.*\/)?[^/]*ledger[^/]*$/,
	/^src\/(?:.*\/)?expense-payments[^/]*$/,
	/^src\/(?:.*\/)?[^/]*invite[^/]*$/,
];
const isSource = (file) => /\.(?:ts|tsx|mjs|js)$/.test(file) && !/\.(?:test|d)\.[^/]*$/.test(file);
export const matchesFloor = (file) =>
	isSource(file) && PATTERNS.some((pattern) => pattern.test(file));

/** @typedef {{ lines: number, branches: number }} Floor */
/** @type {Floor} */
const DEFAULT_FLOOR = { lines: 80, branches: 80 };
// Measured on the combined run on 2026-11-22, rounded down. settle-notify.ts only forwards to the
// notification dispatcher, which the route tests fake; the fixture and share-sheet files are UI
// helpers that match the invite pattern, and use-invite-join.ts is a client hook no unit test
// imports (the fixture e2e suite drives it). Raise a floor when tests improve; never lower one
// to get a change through.
/** @type {Record<string, Floor>} */
const FLOORS = {
	'src/app/invite/[token]/invite-metadata.ts': { lines: 100, branches: 93 },
	'src/app/invite/[token]/use-invite-join.ts': { lines: 0, branches: 0 },
	'src/components/wg/invite-share.ts': { lines: 63, branches: 40 },
	'src/core/db/invite-preview.ts': { lines: 100, branches: 100 },
	'src/core/db/schema-invites.ts': { lines: 93, branches: 100 },
	'src/core/db/wg-invites.ts': { lines: 100, branches: 88 },
	'src/core/mail/solo-invite.ts': { lines: 97, branches: 73 },
	'src/core/utils/invite-token.ts': { lines: 100, branches: 100 },
	'src/features/expenses/components/debts/settlement-errors.ts': { lines: 100, branches: 100 },
	'src/features/expenses/server/expense-ledger.ts': { lines: 100, branches: 100 },
	'src/features/expenses/server/expense-payments.ts': { lines: 100, branches: 83 },
	'src/features/expenses/server/settle-debt.ts': { lines: 100, branches: 100 },
	'src/features/expenses/server/settle-notify.ts': { lines: 19, branches: 100 },
	'src/features/expenses/server/statement-ledger.ts': { lines: 98, branches: 94 },
	'src/features/expenses/settlement-scope.ts': { lines: 99, branches: 97 },
	'src/fixtures/invites.ts': { lines: 68, branches: 50 },
};

function parseLcov(text) {
	const files = new Map();
	let current;
	for (const line of text.split('\n')) {
		if (line.startsWith('SF:')) {
			current = { lf: 0, lh: 0, brf: 0, brh: 0 };
			files.set(line.slice(3), current);
		} else if (current && /^(LF|LH|BRF|BRH):/.test(line)) {
			const [key, value] = line.split(':');
			current[key.toLowerCase()] = Number(value);
		}
	}
	return files;
}

/**
 * Skipped tests in a Node TAP report. Test points start with `ok`/`not ok` (indented for
 * subtests) and escape `#` in names, so a `# SKIP` directive cannot come from a test name or a
 * log line. The runner's final `# skipped N` summary has to agree; a log line that looks like a
 * summary only ever comes before it.
 */
/** @param {string} tap @returns {{ points: number, error?: string }} */
export function countSkipped(tap) {
	const points = tap.match(/^\s*(?:not )?ok \d+\b.*# SKIP\b.*$/gim)?.length ?? 0;
	const summaries = [...tap.matchAll(/^# skipped (\d+)$/gm)];
	const summary = summaries.at(-1);
	if (!summary) return { points, error: 'no "# skipped" summary line' };
	const reported = Number(summary[1]);
	if (reported !== points) {
		return { points, error: `summary says ${reported} skipped, test points say ${points}` };
	}
	return { points };
}

const percent = (hit, found) => (found === 0 ? 100 : (100 * hit) / found);

/**
 * Checks coverage and skips; `sources` are the repo-relative files under src/.
 * @param {{ lcov: string, tap: string, sources: string[], floors?: Record<string, Floor> }} input
 */
export function checkFloor({ lcov, tap, sources, floors = FLOORS }) {
	const files = parseLcov(lcov);
	const report = [];
	const failures = [];
	const matching = [...new Set([...sources, ...files.keys()])].filter(matchesFloor).sort();
	for (const file of matching) {
		const c = files.get(file);
		const floor = floors[file] ?? DEFAULT_FLOOR;
		const lines = c ? percent(c.lh, c.lf) : 0;
		const branches = c ? percent(c.brh, c.brf) : 0;
		const measured = c ? '' : ' (no test imports it)';
		report.push(
			`${file}: lines ${lines.toFixed(2)} % (floor ${floor.lines}), branches ${branches.toFixed(2)} % (floor ${floor.branches})${measured}`,
		);
		if (lines < floor.lines)
			failures.push(`${file}: lines ${lines.toFixed(2)} % < ${floor.lines} %`);
		if (branches < floor.branches) {
			failures.push(`${file}: branches ${branches.toFixed(2)} % < ${floor.branches} %`);
		}
	}
	for (const file of Object.keys(floors)) {
		if (!matching.includes(file))
			failures.push(`${file}: has a floor but no such file, rename the entry`);
	}
	const skipped = countSkipped(tap);
	if (skipped.error) failures.push(`TAP report: ${skipped.error}`);
	else if (skipped.points > 0)
		failures.push(`${skipped.points} test(s) skipped, see "# SKIP" in the TAP report`);
	return { report, failures };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [lcovPath, tapPath] = process.argv.slice(2);
	if (!lcovPath || !tapPath) {
		process.stderr.write('Usage: node scripts/check-coverage-floor.mjs <lcov.info> <tests.tap>\n');
		process.exit(2);
	}
	const { report, failures } = checkFloor({
		lcov: readFileSync(lcovPath, 'utf8'),
		tap: readFileSync(tapPath, 'utf8'),
		sources: globSync('src/**/*'),
	});
	process.stdout.write(`${report.join('\n')}\n`);
	if (failures.length > 0) {
		process.stderr.write(`\nCoverage floor failed:\n${failures.map((f) => `- ${f}`).join('\n')}\n`);
		process.exit(1);
	}
	process.stdout.write('\nCoverage floor holds, no test skipped.\n');
}
