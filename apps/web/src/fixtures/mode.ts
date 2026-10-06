/**
 * Server-side switch for the database-free Playwright build (`test:e2e:fixtures`).
 *
 * Fixture mode serves the fixture roster and trusts a plain member-id header
 * without real authentication, so it must never activate on a hosted
 * deployment: Vercel sets `VERCEL=1` on every build and function (Preview and
 * Production alike), while the local/CI fixture runs only fake
 * `VERCEL_ENV=preview`. Every condition is required, so a single stray
 * variable can never switch a real deployment into it.
 */
export function isE2EDbDownMode(): boolean {
	return (
		(process.env.E2E_FIXTURE_MODE === 'true' || process.env.NODE_ENV === 'test') &&
		process.env.VERCEL !== '1' &&
		process.env.VERCEL_ENV !== 'production' &&
		process.env.NEXT_PUBLIC_DB_DOWN === 'true' &&
		process.env.CI === 'true' &&
		!process.env.POSTGRES_URL &&
		!process.env.DATABASE_URL
	);
}
