#!/usr/bin/env node
/**
 * Feature isolation boundary check for the vertical-slice architecture.
 *
 * Rule: a file under src/features/<X>/** may import from @/core/**,
 * @/shared/**, npm packages, or its own files — never from
 * src/features/<Y>/** for a different Y. Cross-feature system effects
 * (e.g. posting to the pinnwand feed) route through a core/ function
 * instead (see core/activity-feed.ts) rather than one feature importing
 * another's internals directly.
 *
 * Relative specifiers are resolved before checking, so `../chat/x` is
 * caught exactly like `@/features/chat/x` — an alias-only check would
 * leave the shortest path across the boundary wide open.
 *
 * Regex-based on import/require specifiers rather than a full TS parse —
 * this only needs the string literal, and the project already runs
 * tsc/biome for everything else.
 *
 * Usage: node scripts/check-feature-boundaries.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');
const FEATURES_DIR = join(SRC, 'features');
// Covers `from '...'`, `require('...')`, dynamic `import('...')` and
// side-effect `import '...'`.
const SPECIFIER_RE = /(?:from\s+|require\s*\(\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
const CODE_FILE_RE = /\.(ts|tsx)$/;

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (CODE_FILE_RE.test(entry)) out.push(full);
	}
	return out;
}

/** Which feature a specifier points into, or null if it leaves features/ entirely. */
function featureOf(specifier, fromDir) {
	const aliased = specifier.match(/^@\/features\/([^/]+)/);
	if (aliased) return aliased[1];
	if (!specifier.startsWith('.')) return null;

	const abs = resolve(fromDir, specifier);
	const rel = relative(FEATURES_DIR, abs);
	if (rel.startsWith('..') || rel === '') return null;
	return rel.split(sep)[0];
}

function main() {
	let ownFeatures;
	try {
		ownFeatures = readdirSync(FEATURES_DIR);
	} catch {
		process.stdout.write('[feature-boundaries] no src/features directory yet, nothing to check.\n');
		return;
	}

	const violations = [];
	for (const feature of ownFeatures) {
		const featureDir = join(FEATURES_DIR, feature);
		if (!statSync(featureDir).isDirectory()) continue;
		for (const file of walk(featureDir)) {
			const source = readFileSync(file, 'utf-8');
			for (const match of source.matchAll(SPECIFIER_RE)) {
				const imported = featureOf(match[1], dirname(file));
				if (imported && imported !== feature) {
					violations.push(
						`${relative(SRC, file)}: imports "${match[1]}" (feature "${feature}" -> "${imported}")`,
					);
				}
			}
		}
	}

	if (violations.length > 0) {
		console.error('[feature-boundaries] FAIL: cross-feature imports found:\n');
		for (const v of violations) console.error(`  - ${v}`);
		console.error(
			'\nA feature may only import from @/core/**, @/shared/**, npm packages, or its own files.\n' +
				'Route cross-feature effects through a core/ function instead (see core/activity-feed.ts).',
		);
		process.exit(1);
	}
	process.stdout.write(
		`[feature-boundaries] OK: ${ownFeatures.length} feature(s), no cross-feature imports.\n`,
	);
}

main();
