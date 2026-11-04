// Release notes live in CHANGELOG.md. Without arguments this checks that every release section is
// well formed, newest first, and that the newest one matches the version in package.json. With a
// tag (`node scripts/release-notes.mjs v1.2.3`) it also checks the tag and prints that section,
// which the release workflow publishes as the GitHub release text.
import { readFileSync } from 'node:fs';

const SECTION = /^## \[(\d+)\.(\d+)\.(\d+)\] - (\d{4}-\d{2}-\d{2})$/;

function fail(message) {
	console.error(`[release-notes] ${message}`);
	process.exit(1);
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const lines = changelog.split('\n');

const releases = [];
for (const [index, line] of lines.entries()) {
	if (!line.startsWith('## ')) continue;
	if (line === '## [Unreleased]') {
		if (releases.length > 0) fail('"## [Unreleased]" has to come before the first release.');
		continue;
	}
	const match = SECTION.exec(line);
	if (!match) fail(`"${line}" is not "## [X.Y.Z] - YYYY-MM-DD".`);
	const [, major, minor, patch, date] = match;
	releases.push({
		version: `${major}.${minor}.${patch}`,
		parts: [major, minor, patch].map(Number),
		date,
		index,
	});
}

if (releases.length === 0) fail('CHANGELOG.md has no release section.');
for (let i = 1; i < releases.length; i++) {
	const [newer, older] = [releases[i - 1], releases[i]];
	const order = newer.parts.findIndex((part, k) => part !== older.parts[k]);
	if (order === -1 || newer.parts[order] < older.parts[order]) {
		fail(`${newer.version} has to be newer than ${older.version}, the section below it.`);
	}
	if (newer.date < older.date) fail(`${newer.version} is dated before ${older.version}.`);
}
for (const release of releases) {
	if (
		!changelog.includes(
			`\n[${release.version}]: https://github.com/Abuarchiv/manawg/releases/tag/v${release.version}`,
		)
	) {
		fail(`The link for [${release.version}] at the end of CHANGELOG.md is missing.`);
	}
}

const latest = releases[0];
if (latest.version !== version) {
	fail(`package.json says ${version}, but the newest CHANGELOG.md section is ${latest.version}.`);
}

const tag = process.argv[2];
if (tag === undefined) {
	process.stdout.write(`[release-notes] OK (${version}).\n`);
} else {
	if (tag !== `v${version}`) fail(`Tag ${tag} does not match version ${version} in package.json.`);
	const links = lines.findIndex((line, i) => i > latest.index && /^\[[^\]]+\]: /.test(line));
	const end = releases[1]?.index ?? (links === -1 ? lines.length : links);
	const body = lines
		.slice(latest.index + 1, end)
		.join('\n')
		.trim();
	if (body === '') fail(`The section for ${version} is empty.`);
	process.stdout.write(`${body}\n`);
}
