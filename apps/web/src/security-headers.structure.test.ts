import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The CSP policy itself is defined in @/shared/lib/security-headers
// (see its own security-headers.test.ts) so both zones' middleware apply
// the exact same policy. This test only checks that this zone's middleware
// actually wires it into every page response.
describe('security header configuration', () => {
	it('wires the shared CSP into every page response', () => {
		const middlewareSource = readFileSync(resolve(process.cwd(), 'src/middleware.ts'), 'utf8');

		expect(middlewareSource).toContain('Content-Security-Policy');
		expect(middlewareSource).toContain('@/shared/lib/security-headers');
	});
});
