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

/**
 * A test loads an independent copy of a module graph, such as a second browser tab with its own
 * module state, by importing the entry with `?instance=<id>`. The query carries over to the
 * graph's `@/` and relative imports; module mocks for that copy name the same query.
 */
function inInstanceOf(parentURL, url) {
	const instance = parentURL ? new URL(parentURL).searchParams.get('instance') : null;
	if (!instance) return url;
	const next = new URL(url);
	next.searchParams.set('instance', instance);
	return next.href;
}

export async function resolve(specifier, context, nextResolve) {
	// Unit tests import server modules directly, as the server bundle does (`react-server`).
	if (specifier === 'server-only') {
		return nextResolve(specifier, {
			...context,
			conditions: [...(context.conditions ?? []), 'react-server'],
		});
	}
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
		if (file)
			return nextResolve(inInstanceOf(context.parentURL, pathToFileURL(file).href), context);
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
