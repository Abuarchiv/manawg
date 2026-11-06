// Keeps stray files out of the repository. Every top-level entry has to be listed below, and local
// notes, editor state and assistant state are never committed, at any depth.
import { execFileSync } from 'node:child_process';

const TOP_LEVEL = new Set([
	'.devcontainer',
	'.dockerignore',
	'.env.example',
	'.github',
	'.gitignore',
	'.npmrc',
	'.nvmrc',
	'.vercelignore',
	'apps',
	'biome.json',
	'CHANGELOG.md',
	'CODE_OF_CONDUCT.md',
	'compose.yaml',
	'CONTRIBUTING.md',
	'docker',
	'Dockerfile',
	'docs',
	'knip.json',
	'LICENSE',
	'openspec',
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'portainer-template.json',
	'README.de.md',
	'README.md',
	'scripts',
	'SECURITY.md',
	'supabase',
	'THIRD-PARTY-NOTICES.md',
]);

const LOCAL_ONLY = [
	/(^|\/)\.DS_Store$/,
	/(^|\/)(AGENTS|CLAUDE|GEMINI|HANDOFF|NOTES|PLAN|TODO)\.md$/i,
	/(^|\/)\.(agents|claude|codex|cursor|kilo|kilocode|windsurf)\//,
	/(^|\/)graphify-out\//,
	/\.(bak|orig|rej|swp)$/,
];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
	.split('\0')
	.filter(Boolean);

const problems = [];
for (const file of files) {
	const top = file.split('/')[0];
	if (!TOP_LEVEL.has(top)) {
		problems.push(`${file}: "${top}" is not an expected top-level entry`);
	} else if (LOCAL_ONLY.some((pattern) => pattern.test(file))) {
		problems.push(`${file}: local file, keep it out of the repository`);
	}
}

if (problems.length > 0) {
	console.error(problems.join('\n'));
	console.error(
		'\n[repo-files] Remove these files, or add a new top-level entry to scripts/check-repo-files.mjs.',
	);
	process.exit(1);
}
process.stdout.write(`[repo-files] OK (${files.length} tracked files).\n`);
