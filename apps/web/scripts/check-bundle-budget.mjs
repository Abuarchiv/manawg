#!/usr/bin/env node
/**
 * Bundle budget enforcement (gzip sizes, aligned with Next.js build report).
 *
 * Reads `.next/app-build-manifest.json` (App Router) and computes:
 *  - Shared first-load JS = gzip(union of chunks present in EVERY app page)
 *  - Per-route JS         = gzip(page chunks - shared chunks - lazy chunks)
 *
 * Budgets:
 *  - Shared first-load JS:  SHARED_JS_BUDGET_KB
 *  - Any individual route:  PER_ROUTE_BUDGET_KB
 *
 * Excluded from per-route caps and reported informationally only:
 *  - Tesseract OCR chunk:   only loaded on /wg/[code]/import OCR step
 *  - three.js / @react-three: only loaded on `/` via Hero3D dynamic gate
 *
 * Usage: pnpm --filter @manawg/web bundle:check
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const KILOBYTE = 1024;
const SHARED_JS_BUDGET_KB = 120;
const PER_ROUTE_BUDGET_KB = 55;
const TESSERACT_INFO_BUDGET_KB = 2500;
const LAZY_CHUNK_HINTS = ['tesseract', 'three', 'react-three'];
const TESSERACT_CHUNK_HINT = 'tesseract';

const PROJECT_ROOT = resolve(process.cwd());
const NEXT_DIR = join(PROJECT_ROOT, '.next');
const APP_MANIFEST = join(NEXT_DIR, 'app-build-manifest.json');

function fail(message) {
	console.error(`\n[bundle-budget] FAIL: ${message}`);
	process.exit(1);
}

function info(message) {
	process.stdout.write(`[bundle-budget] ${message}\n`);
}

function gzipSizeKb(relativePath) {
	const abs = join(NEXT_DIR, relativePath);
	if (!existsSync(abs)) return 0;
	const raw = readFileSync(abs);
	return gzipSync(raw).length / KILOBYTE;
}

function sumGzipKb(paths) {
	let total = 0;
	for (const p of paths) {
		if (!p.endsWith('.js')) continue;
		total += gzipSizeKb(p);
	}
	return total;
}

function readJson(path) {
	if (!existsSync(path)) {
		fail(`Manifest not found: ${path}. Run \`pnpm --filter @manawg/web build\` first.`);
	}
	return JSON.parse(readFileSync(path, 'utf-8'));
}

function isLazyChunk(path) {
	return LAZY_CHUNK_HINTS.some((hint) => path.includes(hint));
}

function scanTesseractRawKb() {
	const chunksDir = join(NEXT_DIR, 'static/chunks');
	if (!existsSync(chunksDir)) return 0;
	let total = 0;
	for (const f of readdirSync(chunksDir)) {
		if (f.includes(TESSERACT_CHUNK_HINT) && f.endsWith('.js')) {
			total += statSync(join(chunksDir, f)).size / KILOBYTE;
		}
	}
	return total;
}

function main() {
	const appManifest = readJson(APP_MANIFEST);
	const pages = appManifest.pages ?? {};
	const pageEntries = Object.entries(pages);
	if (pageEntries.length === 0) fail('No pages in app-build-manifest.json');

	// Shared = chunks present in EVERY page (Next.js semantics).
	const counts = new Map();
	for (const [, chunks] of pageEntries) {
		for (const c of new Set(chunks)) {
			counts.set(c, (counts.get(c) ?? 0) + 1);
		}
	}
	const totalPages = pageEntries.length;
	const sharedChunks = new Set(
		[...counts.entries()].filter(([, n]) => n === totalPages).map(([c]) => c),
	);

	const sharedKb = sumGzipKb([...sharedChunks]);
	const failures = [];

	info(`Shared first-load JS (gzip): ${sharedKb.toFixed(1)} kB (budget ${SHARED_JS_BUDGET_KB} kB)`);
	if (sharedKb > SHARED_JS_BUDGET_KB) {
		failures.push(
			`Shared first-load JS ${sharedKb.toFixed(1)} kB exceeds ${SHARED_JS_BUDGET_KB} kB`,
		);
	}

	const perRouteResults = [];
	for (const [page, chunks] of pageEntries) {
		const routeOnly = chunks.filter((c) => !sharedChunks.has(c) && !isLazyChunk(c));
		const sizeKb = sumGzipKb(routeOnly);
		perRouteResults.push({ page, sizeKb });
		if (sizeKb > PER_ROUTE_BUDGET_KB) {
			failures.push(`Route ${page} = ${sizeKb.toFixed(1)} kB exceeds ${PER_ROUTE_BUDGET_KB} kB`);
		}
	}

	const tesseractKb = scanTesseractRawKb();
	if (tesseractKb > 0) {
		const status = tesseractKb > TESSERACT_INFO_BUDGET_KB ? 'WARN' : 'INFO';
		info(`[${status}] Tesseract OCR chunk: ${tesseractKb.toFixed(1)} kB raw (informational only)`);
	} else {
		info('Tesseract OCR chunk not emitted as static asset (runtime CDN load)');
	}

	const sortedRoutes = [...perRouteResults].sort((a, b) => b.sizeKb - a.sizeKb).slice(0, 5);
	info('Top 5 routes by route-specific gzip JS:');
	for (const r of sortedRoutes) {
		info(`  ${r.page.padEnd(48)} ${r.sizeKb.toFixed(1)} kB`);
	}

	if (failures.length > 0) {
		console.error('\n[bundle-budget] Budget violations:');
		for (const f of failures) console.error(`  - ${f}`);
		process.exit(1);
	}
	info('All bundle budgets within limits.');
}

main();
