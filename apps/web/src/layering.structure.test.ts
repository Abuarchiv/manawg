import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectSourceFiles } from './test-support/source-tree';

/**
 * Structural guard, not a unit test.
 *
 * The dependency arrow runs one way: `app/` composes pages out of `components/`
 * and `lib/`, never the other way round. That broke once — `InventoryItemDto`
 * was declared inside `vorraete/page.tsx` and imported by three components, so
 * the page imported the components and the components imported the page. Each
 * file looked reasonable on its own; only the shape of the whole tree showed
 * the cycle.
 *
 * A type declared in a page is the usual way this starts: it is the shortest
 * path when you need the shape in one more place. This test makes that path
 * fail instead, which is cheap to fix at the moment it happens and expensive
 * to untangle later.
 */

const SRC = __dirname;
const APP_IMPORT = /from\s+'@\/app\//;
const LOWER_LAYERS = ['components/', 'lib/', 'hooks/'];

describe('layering', () => {
	it('keeps the dependency arrow pointing from app into components and lib, never back', () => {
		const offenders = collectSourceFiles(SRC)
			.map((file) => relative(SRC, file))
			.filter((file) => LOWER_LAYERS.some((layer) => file.startsWith(layer)))
			.filter((file) => APP_IMPORT.test(readFileSync(`${SRC}/${file}`, 'utf8')));

		expect(offenders).toEqual([]);
	});
});
