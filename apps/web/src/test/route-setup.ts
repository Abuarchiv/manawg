import { vi } from 'vitest';
import { routeDb, routeMocks } from './route-harness';

/**
 * Setup file for the `route` vitest project: installs the module stubs that
 * every `/api/**` handler test needs, so individual test files no longer
 * repeat them.
 *
 * `importOriginal` is used deliberately wherever a module has real parts worth
 * keeping — the schema tables, `MEMBER_ID_HEADER`, the limiter definitions.
 * Only the pieces that need a database or reach the network are replaced.
 *
 * Not stubbed on purpose, because the real implementations work fine under
 * test: `@manawg/shared/lib/share-code` (pure), `@/lib/e2e-db-down` (reads env, off unless
 * the E2E vars are set), and the drizzle operators.
 *
 * `@/lib/rate-limit` is deliberately absent too. With no Upstash credentials
 * configured it fails open, which is exactly what a test wants by default —
 * and 15 suites rely on that. The handful of tests asserting a 429 stub it
 * themselves.
 */

vi.mock('@/lib/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/lib/db')>()),
	db: routeDb,
}));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/lib/api-auth')>()),
	requireMember: (...args: unknown[]) => routeMocks.requireMember(...args),
}));

vi.mock('@/lib/wg/audit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/lib/wg/audit')>()),
	recordAuditEvent: (...args: unknown[]) => routeMocks.recordAuditEvent(...args),
}));

vi.mock('@/lib/notification-dispatch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/lib/notification-dispatch')>()),
	dispatchNotification: (...args: unknown[]) => routeMocks.dispatchNotification(...args),
}));
