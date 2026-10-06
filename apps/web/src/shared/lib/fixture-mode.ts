/**
 * True only in the database-free Playwright build (`test:e2e:fixtures`), where
 * the browser talks to fixture WGs without a Supabase session. Both flags are
 * required so a single stray variable can never switch a real build into it.
 *
 * The `process.env.NEXT_PUBLIC_*` reads must stay literal: Next.js inlines
 * them at build time only in that form.
 */
export function isClientFixtureMode(): boolean {
	return (
		process.env.NEXT_PUBLIC_DB_DOWN === 'true' &&
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE === 'true'
	);
}
