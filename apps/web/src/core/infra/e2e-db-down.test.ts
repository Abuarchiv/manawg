import { describe, expect, it, vi } from 'vitest';
import { isE2EDbDownMode } from './e2e-db-down';

describe('isE2EDbDownMode', () => {
	it('requires an explicit non-production fixture mode', () => {
		vi.stubEnv('E2E_FIXTURE_MODE', 'true');
		vi.stubEnv('CI', 'true');
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('VERCEL_ENV', 'development');

		expect(isE2EDbDownMode()).toBe(true);

		vi.stubEnv('VERCEL_ENV', 'production');
		expect(isE2EDbDownMode()).toBe(false);
	});
});
