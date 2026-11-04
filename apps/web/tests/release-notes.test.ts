import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const SCRIPT = new URL('../../../scripts/release-notes.mjs', import.meta.url).pathname;
const link = (version: string) =>
	`[${version}]: https://github.com/Abuarchiv/manawg/releases/tag/v${version}`;

function run(changelog: string, version: string, tag?: string) {
	const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
	writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
	const args = tag ? [SCRIPT, tag] : [SCRIPT];
	return spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
}

const TWO = `# Changelog\n\n## [Unreleased]\n\n## [1.0.1] - 2026-11-05\n\n### Fixed\n\n- A fix\n\n## [1.0.0] - 2026-11-04\n\n- First\n\n${link('1.0.1')}\n${link('1.0.0')}\n`;

test('release notes print the section of the tagged version', () => {
	const result = run(TWO, '1.0.1', 'v1.0.1');
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, '### Fixed\n\n- A fix\n');
	assert.equal(run(TWO, '1.0.1').status, 0);
});

test('release notes reject a changelog that disagrees with package.json or the tag', () => {
	assert.equal(run(TWO, '1.0.0').status, 1);
	assert.equal(run(TWO, '1.0.1', 'v1.0.0').status, 1);
	const swapped = `## [1.0.0] - 2026-11-04\n\n- a\n\n## [1.0.1] - 2026-11-05\n\n- b\n\n${link('1.0.1')}\n${link('1.0.0')}\n`;
	assert.equal(run(swapped, '1.0.0').status, 1);
	assert.equal(run(`## [1.0.1] - 2026-11-05\n\n- a\n`, '1.0.1').status, 1);
	assert.equal(run(`## 1.0.1 - 2026-11-05\n\n- a\n\n${link('1.0.1')}\n`, '1.0.1').status, 1);
	assert.equal(run(`## [1.0.1] - 2026-11-05\n\n${link('1.0.1')}\n`, '1.0.1', 'v1.0.1').status, 1);
});
