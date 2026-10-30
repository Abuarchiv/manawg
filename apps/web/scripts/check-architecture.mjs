#!/usr/bin/env node
/**
 * Structural rules for apps/web, enforced in lint and CI.
 *
 * Rules (ids are used in the baseline file):
 *   layers          import direction between top-level source layers (see LAYER_RULES)
 *   cross-feature   a feature imports another feature
 *   file-size       source file over SOURCE_LINE_BUDGET, test file over TEST_LINE_BUDGET
 *   test-loader     a test evaluates source through node:vm or transpileModule
 *   test-location   unit tests must be *.test.ts, e2e specs *.spec.ts under e2e/
 *   fixture-seam    fixture-mode checks outside src/fixtures/
 *   idempotency     route handlers touch the claim protocol instead of withIdempotentWrite
 *   status-literal  apiError(...) with a numeric status instead of an HTTP constant
 *   server-only     a features/<x>/server/ module without `import 'server-only'`
 *   client-server   a 'use client' module imports a server/ module
 *   client-zod      a 'use client' module reaches zod through its runtime imports (it would ship in the bundle)
 *   comment-lang    a comment written in German (code comments are English)
 *   comment-history a comment that narrates history ("used to", "previously", ...)
 *   banned-import   an import of a removed dependency
 *   route-limiter   a route answers a failed limiter check itself instead of via rateLimitResponse
 *   route-auth      a route calls getAuthenticatedUser instead of requireAccount/requireWgMember
 *   route-wrapper   a /api/wg/[code]/ route exports a handler outside withWgRoute
 *   hook-filename   a file under src/ named useFoo.ts instead of use-foo.ts
 *   i18n-literal    German UI copy outside the message catalogs (see scripts/i18n-literal-rule.mjs)
 *   i18n-catalog-import  a value import of the message catalogs outside the two server modules
 *
 * `scripts/architecture-baseline.json` lists known violations that are still being paid down.
 * The check fails on any violation that is not listed, on a file-size entry that grew, and on a
 * listed entry that no longer violates (remove it, the baseline only shrinks).
 *
 * Usage: node scripts/check-architecture.mjs [--write-baseline]
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { catalogImportFindings, isLiteralChecked, literalFindings } from './i18n-literal-rule.mjs';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const BASELINE_PATH = join(ROOT, 'scripts', 'architecture-baseline.json');

const SOURCE_LINE_BUDGET = 400;
const TEST_LINE_BUDGET = 800;

/** Which layers each layer may import. A feature may additionally import itself. */
const LAYER_RULES = {
	shared: ['shared'],
	core: ['core', 'shared'],
	components: ['components', 'core', 'shared'],
	features: ['components', 'core', 'shared'],
	composition: ['composition', 'features', 'components', 'core', 'shared'],
	fixtures: ['fixtures', 'composition', 'features', 'components', 'core', 'shared'],
	app: ['app', 'fixtures', 'composition', 'features', 'components', 'core', 'shared'],
};

const BANNED_IMPORTS = ['zustand'];
const CLAIM_PROTOCOL_IDENTIFIERS = [
	'claimResponseSlot',
	'claimReplaySlotWithRetry',
	'lockClaimedResponse',
	'completeClaimedResponse',
	'releaseClaimedResponse',
	'ReplayCache',
	'claimIdempotencySlot',
];
const FIXTURE_IDENTIFIERS = /\bisE2EDbDownMode\b/;
const SPECIFIER_RE = /(?:from\s+|require\s*\(\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
const GERMAN_RE =
	/\b(und|nicht|wird|werden|wenn|damit|oder|auch|noch|sonst|bereits|immer|keine?|sind|ist|dass|weil|beim|nach|soll|muss|kann|bei|zum|zur|eine?n?|der|das|dem|den|für|über|wäre|sähe|hält|müssen|können|würde)\b/i;
/** Quoted UI copy inside an English comment ("gelöscht", „Nächste:r“) is not a German comment. */
const QUOTED_RE = /„[^“”]*[“”]|"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|«[^»]*»/g;
const HISTORY_RE =
	/\b(used to|previously|no longer|formerly|was changed|we now|now (?:fails|returns|uses|rejects|throws)|extracted (?:from|here)|carried their|kept for history|moved into the|once (?:let|caused|made)|ponytail)\b/i;

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];
const CODE_RE = /\.(ts|tsx|mjs|cjs|js)$/;

function walk(dir) {
	if (!existsSync(dir)) return [];
	const out = [];
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (CODE_RE.test(entry)) out.push(full);
	}
	return out;
}

const rel = (file) => relative(ROOT, file).split(sep).join('/');
const isTestFile = (r) =>
	/\.(test|spec)\.(ts|tsx|mjs|cjs|js)$/.test(r) || r.startsWith('tests/') || r.startsWith('e2e/');

/** Top-level layer of a path under src/, or null outside src/. Root files count as app. */
function layerOf(absPath) {
	const r = relative(SRC, absPath);
	if (r.startsWith('..')) return null;
	const [first, second] = r.split(sep);
	if (second === undefined) return { layer: 'app' };
	if (first === 'features') return { layer: 'features', feature: second };
	if (first in LAYER_RULES) return { layer: first };
	return { layer: 'app' };
}

function resolveSpecifier(specifier, fromFile) {
	if (specifier.startsWith('@/')) return join(SRC, specifier.slice(2));
	if (specifier.startsWith('.')) return resolve(dirname(fromFile), specifier);
	return null;
}

/** Strip string and template literal contents so comment checks only see comments. */
function commentsOf(source) {
	const comments = [];
	const re =
		/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g;
	for (const match of source.matchAll(re)) {
		const text = match[0];
		if (text.startsWith('//') || text.startsWith('/*')) {
			const line = source.slice(0, match.index).split('\n').length;
			comments.push({ line, text });
		}
	}
	return comments;
}

/** Runtime import specifiers of a module; `import type` is erased at build time. */
function runtimeSpecifiers(source) {
	const runtime = source.replace(/\b(?:import|export)\s+type\b[^;]*?from\s*['"][^'"]+['"]/g, '');
	return [...runtime.matchAll(SPECIFIER_RE)].map((match) => match[1]);
}

function resolveModule(target) {
	const candidates = [
		target,
		...MODULE_EXTENSIONS.flatMap((ext) => [target + ext, join(target, `index${ext}`)]),
	];
	return candidates.find((file) => existsSync(file) && statSync(file).isFile()) ?? null;
}

/** The first module reachable from a client entry that imports zod, or null. */
function zodImporterFrom(entry) {
	const seen = new Set([entry]);
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		const specifiers = runtimeSpecifiers(readFileSync(file, 'utf8'));
		if (specifiers.some((name) => name === 'zod' || name.startsWith('zod/'))) return file;
		for (const specifier of specifiers) {
			const target = resolveSpecifier(specifier, file);
			const next = target && resolveModule(target);
			if (next && !seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return null;
}

function collect() {
	const violations = [];
	const sizes = {};
	const add = (rule, file, detail) =>
		violations.push(`${rule} ${file}${detail ? ` ${detail}` : ''}`);

	const files = [...walk(SRC), ...walk(join(ROOT, 'tests')), ...walk(join(ROOT, 'e2e'))];
	for (const file of files) {
		const r = rel(file);
		const source = readFileSync(file, 'utf8');
		const test = isTestFile(r);
		const lines = source.split('\n').length;
		const budget = test ? TEST_LINE_BUDGET : SOURCE_LINE_BUDGET;
		if (lines > budget) sizes[r] = lines;

		if (test) {
			if (/\bnode:vm\b|\btranspileModule\b|\brunInContext\b|\brunInNewContext\b/.test(source)) {
				add('test-loader', r);
			}
			const isE2e = r.startsWith('e2e/');
			const okName = isE2e
				? /\.spec\.ts$/.test(r) || r.startsWith('e2e/support/') || /\.config\.(ts|cjs)$/.test(r)
				: /\.test\.ts$/.test(r) || r.startsWith('tests/support/');
			if (!okName) add('test-location', r);
		}

		if (r.startsWith('src/') && /^use[A-Z]/.test(basename(r))) {
			add('hook-filename', r, 'hook files are kebab-case (use-foo.ts)');
		}

		if (r.startsWith('src/') && !test) {
			const from = layerOf(file);
			for (const match of source.matchAll(SPECIFIER_RE)) {
				const specifier = match[1];
				if (BANNED_IMPORTS.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
					add('banned-import', r, specifier);
				}
				const target = resolveSpecifier(specifier, file);
				if (!target) continue;
				const to = layerOf(target);
				if (!to) continue;
				if (from.layer === 'features' && to.layer === 'features') {
					if (from.feature !== to.feature) add('cross-feature', r, specifier);
					continue;
				}
				if (from.layer === to.layer) continue;
				if (!LAYER_RULES[from.layer].includes(to.layer)) add('layers', r, specifier);
			}
			if (/^\s*['"]use client['"]/.test(source)) {
				const zodImporter = zodImporterFrom(file);
				if (zodImporter) add('client-zod', r, `via ${rel(zodImporter)}`);
				for (const match of source.matchAll(SPECIFIER_RE)) {
					if (/(^|\/)server(\/|$)/.test(match[1]) && match[1].includes('features/')) {
						add('client-server', r, match[1]);
					}
				}
			}

			if (isLiteralChecked(r) && literalFindings(r, source).length > 0) add('i18n-literal', r);
			for (const specifier of catalogImportFindings(file, r, source, SRC)) {
				add('i18n-catalog-import', r, specifier);
			}

			if (FIXTURE_IDENTIFIERS.test(source) && !r.startsWith('src/fixtures/')) {
				add('fixture-seam', r);
			}
			if (r.startsWith('src/app/')) {
				for (const id of CLAIM_PROTOCOL_IDENTIFIERS) {
					if (new RegExp(`\\b${id}\\b`).test(source)) add('idempotency', r, id);
				}
			}
			if (/\bapiError\(\s*[^,()]+,\s*\d{3}\b/.test(source)) add('status-literal', r);
			if (/^src\/app\/api\//.test(r)) {
				for (const match of source.matchAll(/const (\w+) = await checkRateLimit\(/g)) {
					if (
						new RegExp(`(!${match[1]}\\.success\\b|\\b${match[1]}\\.success\\s*\\?)`).test(source)
					)
						add('route-limiter', r, match[1]);
				}
				if (/\bgetAuthenticatedUser\(/.test(source)) add('route-auth', r);
				if (
					/^src\/app\/api\/wg\/\[code\]\//.test(r) &&
					/export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b/.test(source)
				) {
					add('route-wrapper', r);
				}
			}
			if (
				/^src\/features\/[^/]+\/server\//.test(r) &&
				!/import\s+['"]server-only['"]/.test(source)
			) {
				add('server-only', r);
			}
		}

		if (
			r.startsWith('src/') ||
			r.startsWith('tests/') ||
			r.startsWith('e2e/') ||
			r.startsWith('scripts/')
		) {
			let german = 0;
			let history = 0;
			for (const comment of commentsOf(source)) {
				if (comment.text.startsWith('// biome-ignore')) continue;
				if (GERMAN_RE.test(comment.text.replace(QUOTED_RE, ''))) german++;
				if (HISTORY_RE.test(comment.text)) history++;
			}
			if (german > 0) add('comment-lang', r);
			if (history > 0) add('comment-history', r);
		}
	}

	for (const file of walk(join(ROOT, 'scripts'))) {
		const r = rel(file);
		if (r === 'scripts/check-architecture.mjs') continue;
		const lines = readFileSync(file, 'utf8').split('\n').length;
		if (lines > SOURCE_LINE_BUDGET) sizes[r] = lines;
		const source = readFileSync(file, 'utf8');
		let german = 0;
		let history = 0;
		for (const comment of commentsOf(source)) {
			if (GERMAN_RE.test(comment.text.replace(QUOTED_RE, ''))) german++;
			if (HISTORY_RE.test(comment.text)) history++;
		}
		if (german > 0) add('comment-lang', r);
		if (history > 0) add('comment-history', r);
	}

	return { violations: [...new Set(violations)].sort(), sizes };
}

function main() {
	const { violations, sizes } = collect();
	if (process.argv.includes('--write-baseline')) {
		writeFileSync(
			BASELINE_PATH,
			`${JSON.stringify({ violations, fileSize: sizes }, null, '\t')}\n`,
		);
		process.stdout.write(
			`[architecture] baseline written: ${violations.length} violations, ${Object.keys(sizes).length} oversized files.\n`,
		);
		return;
	}

	const baseline = existsSync(BASELINE_PATH)
		? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
		: { violations: [], fileSize: {} };
	const known = new Set(baseline.violations);
	const errors = [];

	for (const v of violations) if (!known.has(v)) errors.push(`new violation: ${v}`);
	for (const v of known)
		if (!violations.includes(v)) errors.push(`fixed, remove from baseline: ${v}`);
	for (const [file, lines] of Object.entries(sizes)) {
		const allowed = baseline.fileSize[file];
		if (allowed === undefined)
			errors.push(`file-size ${file} has ${lines} lines (budget exceeded)`);
		else if (lines > allowed)
			errors.push(`file-size ${file} grew from ${allowed} to ${lines} lines`);
	}
	for (const [file, allowed] of Object.entries(baseline.fileSize)) {
		const lines = sizes[file];
		if (lines === undefined) errors.push(`fixed, remove from baseline: file-size ${file}`);
		else if (lines < allowed)
			errors.push(`file-size ${file} shrank to ${lines}; lower its baseline`);
	}

	if (errors.length > 0) {
		console.error('[architecture] FAIL\n');
		for (const e of errors) console.error(`  - ${e}`);
		console.error(
			`\nBudgets: ${SOURCE_LINE_BUDGET} lines per source file, ${TEST_LINE_BUDGET} per test file.\nRules and layer matrix: scripts/check-architecture.mjs and docs/architecture.md.`,
		);
		process.exit(1);
	}
	const debt = violations.length + Object.keys(sizes).length;
	process.stdout.write(`[architecture] OK (${debt} baseline entries left).\n`);
}

main();
