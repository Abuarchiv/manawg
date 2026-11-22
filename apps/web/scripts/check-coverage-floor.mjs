#!/usr/bin/env node
/**
 * Coverage floor for the money and invite code, checked after the combined unit and database run
 * in the Database workflow:
 *
 *   node scripts/check-coverage-floor.mjs coverage/lcov.info coverage/tests.tap
 *
 * Fails when a file below lists drops under its floor, when a new file matching the money or
 * invite patterns covers less than the default floor, or when the TAP report counts a skipped
 * test (with TEST_DATABASE_URL set, nothing may skip silently). Prints every matching file.
 *
 * The run writes coverage for all files and this script filters them: Node's own
 * --test-coverage-include stops dropping mock.module() stubs, which then overwrite the real
 * file's coverage.
 */

import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';

const PATTERNS = [
	'src/**/settle*',
	'src/**/*ledger*',
	'src/**/expense-payments*',
	'src/**/*invite*',
];
const DEFAULT_FLOOR = { lines: 80, branches: 80 };
// Measured on the combined run on 2026-11-22, rounded down. settle-notify.ts only forwards to the
// notification dispatcher, which the route tests fake; the fixture and share-sheet files are UI
// helpers that match the invite pattern. Raise a floor when tests improve; never lower one
// to get a change through.
const FLOORS = {
	'src/app/invite/[token]/invite-metadata.ts': { lines: 100, branches: 93 },
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

const [lcovPath, tapPath] = process.argv.slice(2);
if (!lcovPath || !tapPath) {
	process.stderr.write('Usage: node scripts/check-coverage-floor.mjs <lcov.info> <tests.tap>\n');
	process.exit(2);
}

const files = new Map();
let current;
for (const line of readFileSync(lcovPath, 'utf8').split('\n')) {
	if (line.startsWith('SF:')) {
		current = { lf: 0, lh: 0, brf: 0, brh: 0 };
		files.set(line.slice(3), current);
	} else if (current && /^(LF|LH|BRF|BRH):/.test(line)) {
		const [key, value] = line.split(':');
		current[key.toLowerCase()] = Number(value);
	}
}

const percent = (hit, found) => (found === 0 ? 100 : (100 * hit) / found);
const failures = [];
for (const [file, c] of files) {
	if (!PATTERNS.some((pattern) => matchesGlob(file, pattern))) continue;
	const floor = FLOORS[file] ?? DEFAULT_FLOOR;
	const lines = percent(c.lh, c.lf);
	const branches = percent(c.brh, c.brf);
	process.stdout.write(
		`${file}: lines ${lines.toFixed(2)} % (floor ${floor.lines}), branches ${branches.toFixed(2)} % (floor ${floor.branches})` +
			'\n',
	);
	if (lines < floor.lines) failures.push(`${file}: lines ${lines.toFixed(2)} % < ${floor.lines} %`);
	if (branches < floor.branches) {
		failures.push(`${file}: branches ${branches.toFixed(2)} % < ${floor.branches} %`);
	}
}
for (const file of Object.keys(FLOORS)) {
	if (!files.has(file)) failures.push(`${file}: has a floor but no coverage, rename the entry`);
}

const skipped = /^# skipped (\d+)$/m.exec(readFileSync(tapPath, 'utf8'));
if (!skipped) failures.push(`${tapPath}: no "# skipped" summary line`);
else if (Number(skipped[1]) > 0)
	failures.push(`${skipped[1]} test(s) skipped, see "# SKIP" in ${tapPath}`);

if (failures.length > 0) {
	process.stderr.write(`\nCoverage floor failed:\n${failures.map((f) => `- ${f}`).join('\n')}\n`);
	process.exit(1);
}
process.stdout.write('\nCoverage floor holds, no test skipped.\n');
