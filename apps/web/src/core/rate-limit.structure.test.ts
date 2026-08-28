import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectSourceFiles } from '../test-support/source-tree';

/**
 * Structural guard, not a unit test.
 *
 * `clientIpKey` deliberately reads the LAST `X-Forwarded-For` entry, because the
 * platform appends it and everything before it is attacker-controlled. Two event
 * routes used to carry their own copy of the helper that read `split(',')[0]` —
 * the spoofable value — which let anyone bypass the read limiter by sending a
 * header. Each copy looked fine in isolation; only comparing them exposed it.
 *
 * This test enforces the invariant across the whole tree, so a future copy of
 * the same helper fails CI instead of quietly reintroducing the bypass.
 */

const SRC = join(__dirname, '..');
const FORWARDED_FOR = /x-forwarded-for/i;
const ALLOWED = ['core/rate-limit.ts'];

describe('client IP resolution', () => {
	it('is derived in exactly one place so no route can reintroduce the spoofable variant', () => {
		const offenders = collectSourceFiles(SRC)
			.map((file) => relative(SRC, file))
			.filter((file) => !ALLOWED.includes(file))
			.filter((file) => FORWARDED_FOR.test(readFileSync(join(SRC, file), 'utf8')));

		expect(offenders).toEqual([]);
	});
});
