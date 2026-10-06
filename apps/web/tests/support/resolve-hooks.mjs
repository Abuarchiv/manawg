// Module resolution for unit tests, matching tsconfig `paths` and the bundler's resolution:
// `@/x` maps to `src/x`, and extensionless or directory specifiers try .ts, .tsx and index files.
// Node strips TypeScript types natively (`--experimental-strip-types`).
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = new URL('../../src/', import.meta.url);
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];

function findFile(basePath) {
	for (const suffix of CANDIDATE_SUFFIXES) {
		const path = basePath + suffix;
		if (existsSync(path) && statSync(path).isFile()) return path;
	}
	return null;
}

export async function resolve(specifier, context, nextResolve) {
	let basePath = null;
	if (specifier.startsWith('@/')) {
		basePath = fileURLToPath(new URL(specifier.slice(2), SRC));
	} else if (
		(specifier.startsWith('./') || specifier.startsWith('../')) &&
		context.parentURL?.startsWith('file:')
	) {
		basePath = fileURLToPath(new URL(specifier, context.parentURL));
	}
	if (basePath) {
		const file = findFile(basePath);
		if (file) return nextResolve(pathToFileURL(file).href, context);
		return nextResolve(specifier, context);
	}
	try {
		return await nextResolve(specifier, context);
	} catch (error) {
		// Packages without an `exports` map (e.g. `next/server`) need the file extension under
		// Node's ESM resolution; the bundler adds it implicitly.
		if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^[@a-z]/i.test(specifier)) throw error;
		return nextResolve(`${specifier}.js`, context);
	}
}
