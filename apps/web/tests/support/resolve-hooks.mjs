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
	// `server-only` throws when imported outside a server bundle; unit tests load server modules
	// directly, so it resolves to an empty module.
	if (specifier === 'server-only') {
		return { url: 'data:text/javascript,export {}', format: 'module', shortCircuit: true };
	}
	let target = null;
	if (specifier.startsWith('@/')) {
		target = new URL(specifier.slice(2), SRC);
	} else if (
		(specifier.startsWith('./') || specifier.startsWith('../')) &&
		context.parentURL?.startsWith('file:')
	) {
		target = new URL(specifier, context.parentURL);
	}
	if (target) {
		// A query string (`./entry.ts?run=2`) is kept so a test can evaluate a module afresh. An
		// `instance` query on the importing module carries over to the project files it imports,
		// giving each instance its own copy of the module graph.
		const instance = context.parentURL
			? new URL(context.parentURL).searchParams.get('instance')
			: null;
		if (instance && !target.search) target.search = `?instance=${instance}`;
		const file = findFile(fileURLToPath(target));
		if (file) return nextResolve(pathToFileURL(file).href + target.search, context);
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

// Side-effect-only entry files without import/export (e.g. `instrumentation-client.ts`) are
// detected as CommonJS, and a dynamic `import()` inside a second evaluation of such a file
// (`./entry.ts?run=2`) never settles. Query-suffixed URLs are therefore always loaded as ESM.
export async function load(url, context, nextLoad) {
	const result = await nextLoad(url, context);
	if (url.includes('?') && result.format === 'commonjs-typescript') {
		return { ...result, format: 'module-typescript' };
	}
	return result;
}
