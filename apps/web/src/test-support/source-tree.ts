import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Walks the source tree for structural tests — the ones that assert an
 * invariant about the codebase as a whole rather than about one function.
 *
 * Lives here because two such tests need it, and a second copy of a tree
 * walker is exactly the kind of duplication those tests exist to catch.
 */
export function collectSourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) collectSourceFiles(full, out);
		else if (/\.tsx?$/.test(full) && !/\.(test|spec)\.tsx?$/.test(full)) out.push(full);
	}
	return out;
}
