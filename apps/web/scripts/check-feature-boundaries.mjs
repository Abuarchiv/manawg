#!/usr/bin/env node
/**
 * Feature isolation boundary check for the vertical-slice architecture.
 *
 * Rule: a file under src/features/<X>/** may import from @/core/**,
 * @manawg/shared/**, npm packages, or its own files — never from
 * src/features/<Y>/** for a different Y. Cross-feature system effects
 * (e.g. posting to the pinnwand feed) route through a core/ function
 * instead (see core/activity-feed.ts) rather than one feature importing
 * another's internals directly.
 *
 * Regex-based on import/require specifiers rather than a full TS parse —
 * this only needs the string literal, and the project already runs
 * tsc/biome for everything else.
 *
 * Usage: node scripts/check-feature-boundaries.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
const FEATURES_DIR = join(SRC, 'features');
const SPECIFIER_RE = /(?:from\s+|require\()\s*['"]([^'"]+)['"]/g;
const CODE_FILE_RE = /\.(ts|tsx)$/;

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) out.push(...walk(full));
		else if (CODE_FILE_RE.test(entry)) out.push(full);
	}
	return out;
}

function featureOf(specifier) {
	const match = specifier.match(/^@\/features\/([^/]+)/);
	return match ? match[1] : null;
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
				const imported = featureOf(match[1]);
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
			'\nA feature may only import from @/core/**, @manawg/shared/**, npm packages, or its own files.\n' +
				'Route cross-feature effects through a core/ function instead (see core/activity-feed.ts).',
		);
		process.exit(1);
	}
	process.stdout.write(
		`[feature-boundaries] OK: ${ownFeatures.length} feature(s), no cross-feature imports.\n`,
	);
}

main();
