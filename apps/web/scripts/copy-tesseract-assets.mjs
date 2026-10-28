/**
 * The OCR worker, its WASM core and the German and English models are served by the app itself
 * from public/tesseract (see features/expenses/ocr.ts), so the CSP names no third-party host and
 * OCR works on instances without public internet access. The files come from the installed
 * packages and are not committed. next.config.ts calls this on every config load: next dev,
 * next build (local, Vercel, Docker) and the Playwright servers all run it. The upstream licence
 * texts are copied next to the files, as Apache-2.0 requires for redistribution.
 */

import {
	copyFileSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
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
const README = `These files are served unmodified from the following open-source projects. Each is
licensed under the Apache License 2.0.

worker.min.js, worker.min.js.LICENSE.txt, LICENSE.tesseract.js.txt
  tesseract.js, https://github.com/naptha/tesseract.js

tesseract-core-*.wasm.js, LICENSE.tesseract.js-core.txt
  tesseract.js-core, https://github.com/naptha/tesseract.js-core

lang/*.traineddata.gz
  Trained models from tessdata_best, https://github.com/tesseract-ocr/tessdata_best,
  packaged by @tesseract.js-data/deu and @tesseract.js-data/eng.

The licence texts of the code are in the LICENSE.* files next to this one.
Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
`;

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

function writeIfChanged(target, content) {
	try {
		if (readFileSync(target, 'utf8') === content) return;
	} catch {
		// The target does not exist yet.
	}
	mkdirSync(path.dirname(target), { recursive: true });
	writeFileSync(target, content);
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
	copyIfChanged(
		path.join(tesseractDir, 'dist', 'worker.min.js.LICENSE.txt'),
		path.join(OUT_DIR, 'worker.min.js.LICENSE.txt'),
	);
	copyIfChanged(
		path.join(tesseractDir, 'LICENSE.md'),
		path.join(OUT_DIR, 'LICENSE.tesseract.js.txt'),
	);
	copyIfChanged(path.join(coreDir, 'LICENSE'), path.join(OUT_DIR, 'LICENSE.tesseract.js-core.txt'));
	writeIfChanged(path.join(OUT_DIR, 'README.txt'), README);
	for (const lang of LANGUAGES) {
		const file = `${lang}.traineddata.gz`;
		const packageDir = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
		copyIfChanged(path.join(packageDir, MODEL_DIR, file), path.join(OUT_DIR, 'lang', file));
	}
}
