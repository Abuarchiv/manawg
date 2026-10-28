/**
 * The OCR worker, its WASM core and the German and English models are served by the app itself
 * from public/tesseract (see features/expenses/ocr.ts), so the CSP names no third-party host and
 * OCR works on instances without public internet access. The files come from the installed
 * packages and are not committed. next.config.ts calls this on every config load: next dev,
 * next build (local, Vercel, Docker) and the Playwright servers all run it.
 */

import { copyFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(APP_DIR, 'public', 'tesseract');
const MODEL_DIR = '4.0.0_best_int';
// The browser picks one of these by SIMD support (getCore.js in tesseract.js); OCR runs LSTM only.
const CORE_FILES = [
	'tesseract-core-lstm.wasm.js',
	'tesseract-core-simd-lstm.wasm.js',
	'tesseract-core-relaxedsimd-lstm.wasm.js',
];
const LANGUAGES = ['deu', 'eng'];

const require = createRequire(import.meta.url);

/** Copies atomically so concurrent config loads never serve a half-written file. */
function copyIfChanged(source, target) {
	try {
		if (statSync(target).size === statSync(source).size) return;
	} catch {
		// The target does not exist yet.
	}
	mkdirSync(path.dirname(target), { recursive: true });
	const partial = `${target}.${process.pid}.tmp`;
	try {
		copyFileSync(source, partial);
		renameSync(partial, target);
	} finally {
		rmSync(partial, { force: true });
	}
}

export function copyTesseractAssets() {
	const tesseractDir = path.dirname(require.resolve('tesseract.js/package.json'));
	const coreDir = path.dirname(
		createRequire(path.join(tesseractDir, 'package.json')).resolve(
			'tesseract.js-core/package.json',
		),
	);
	copyIfChanged(
		path.join(tesseractDir, 'dist', 'worker.min.js'),
		path.join(OUT_DIR, 'worker.min.js'),
	);
	for (const file of CORE_FILES) copyIfChanged(path.join(coreDir, file), path.join(OUT_DIR, file));
	for (const lang of LANGUAGES) {
		const file = `${lang}.traineddata.gz`;
		const packageDir = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
		copyIfChanged(path.join(packageDir, MODEL_DIR, file), path.join(OUT_DIR, 'lang', file));
	}
}
