import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `instrumentation.ts` sitting in the wrong directory is a silent failure:
 * Next.js ignores it, nothing errors, and the boot-time environment report
 * simply never runs. It went unnoticed for exactly
 * that reason, so its location is asserted rather than assumed.
 */

const PACKAGE_ROOT = join(__dirname, '..');
const APP_ROOT = __dirname;

describe('instrumentation hook location', () => {
	it('lives next to the app directory, where Next.js actually looks for it', () => {
		expect(existsSync(join(APP_ROOT, 'app'))).toBe(true);
		expect(existsSync(join(APP_ROOT, 'instrumentation.ts'))).toBe(true);
	});

	it('is not left behind in the package root, where it would be ignored', () => {
		expect(existsSync(join(PACKAGE_ROOT, 'instrumentation.ts'))).toBe(false);
	});
});
