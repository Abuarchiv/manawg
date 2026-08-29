import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Forces "DB not configured" fallback tests (idempotency.test.ts and
// friends) to behave the same locally and under the db-integration CI job,
// which exports POSTGRES_URL/DATABASE_MIGRATION_URL at job level for the
// *.integration.test.ts projects.
const NO_DB_ENV = { POSTGRES_URL: '', DATABASE_URL: '', DATABASE_MIGRATION_URL: '' };

// craftsman-ignore: TS002
export default defineConfig({
	plugins: [react()],
	test: {
		/**
		 * Split by environment instead of booting jsdom for everything: only
		 * `.tsx` suites render components. Giving the other ~136 suites a plain
		 * node environment cut the suite from 61s to ~25s, nearly all of it
		 * environment setup rather than assertions.
		 *
		 * The few `.ts` suites that do touch DOM globals (localStorage,
		 * BroadcastChannel, …) opt in per file with `@vitest-environment jsdom`,
		 * so the requirement stays visible where it applies.
		 */
		projects: [
			{
				extends: true,
				test: {
					name: 'node',
					environment: 'node',
					include: ['src/**/*.{test,spec}.ts'],
					exclude: [
						'e2e/**',
						'node_modules/**',
						'.next/**',
						'src/app/api/**',
						'**/*.integration.test.ts',
					],
					// Deterministic "DB not configured" fallback behavior (see
					// idempotency.test.ts) regardless of what the invoking CI job
					// happens to export — the db-integration job sets POSTGRES_URL
					// at job level for the *.integration.test.ts projects below.
					env: NO_DB_ENV,
				},
			},
			{
				// Route handlers share one harness (src/test/route-harness.ts)
				// instead of each test file re-declaring the same db, auth,
				// audit, notification and rate-limit stubs.
				extends: true,
				test: {
					name: 'route',
					environment: 'node',
					include: ['src/app/api/**/*.{test,spec}.ts'],
					setupFiles: ['./src/test/setup.ts', './src/test/route-setup.ts'],
					exclude: ['e2e/**', 'node_modules/**', '.next/**', '**/*.integration.test.ts'],
					env: NO_DB_ENV,
				},
			},
			{
				// *.integration.test.ts anywhere in src/ runs the real handler
				// against a live Postgres instance (see route.integration.test.ts,
				// idempotency.integration.test.ts, export-schema.integration.test.ts)
				// instead of a mocked db, so it keeps the real process env
				// (POSTGRES_URL etc., set by the db-integration CI job) rather than
				// the DB-cleared env the other projects use. NODE_ENV is overridden
				// to 'development' here (vitest otherwise forces 'test') because a
				// couple of route handlers fail closed on an unavailable rate
				// limiter specifically under NODE_ENV=test — intentional for the
				// mocked 'route' project (see route.test.ts's RED BUG-012), wrong
				// here, where there's no Upstash service by design.
				extends: true,
				test: {
					name: 'integration',
					environment: 'node',
					env: { NODE_ENV: 'development' },
					include: ['src/**/*.integration.test.ts'],
					exclude: ['e2e/**', 'node_modules/**', '.next/**'],
				},
			},
			{
				extends: true,
				test: {
					name: 'dom',
					environment: 'jsdom',
					include: ['src/**/*.{test,spec}.tsx'],
					exclude: ['e2e/**', 'node_modules/**', '.next/**'],
					env: NO_DB_ENV,
				},
			},
		],
		globals: true,
		setupFiles: ['./src/test/setup.ts'],
		exclude: ['e2e/**', 'node_modules/**', '.next/**'],
		maxWorkers: 2,
		testTimeout: 15_000,
		/**
		 * Pinned, because otherwise the suite asserts on whatever timezone the
		 * machine happens to be in: green in CET, red in CI's UTC.
		 *
		 * Europe/Berlin rather than UTC on purpose. Under UTC, local and UTC
		 * date arithmetic give the same answer, so a timezone bug in code like
		 * `getMonthBounds` produces a passing test. A non-zero offset is what
		 * makes the difference observable at all.
		 */
		env: { TZ: 'Europe/Berlin' },
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			include: ['src/**/*.{ts,tsx}'],
			exclude: [
				'src/**/*.{test,spec}.{ts,tsx}',
				'src/**/*.integration.test.{ts,tsx}',
				'src/test/**',
				'src/**/*.d.ts',
			],
			// Only enforced when `--coverage` is passed explicitly (`pnpm
			// test:coverage`), not on the default `pnpm test` — that keeps the
			// fast unit-test loop untouched while still giving CI a gate to wire
			// in. Below the 80% policy floor for now: ratchet this up as gaps
			// close instead of red-lining the whole suite on day one. Set a few
			// points below the measured baseline (statements 59.78%, branches
			// 56.45%, functions 52.78%, lines 62.76% as of 2026-08-01) so small,
			// unrelated test removals don't immediately redline CI.
			thresholds: {
				lines: 60,
				statements: 58,
				functions: 50,
				branches: 55,
			},
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			// `server-only` is a Next.js bundler marker — vitest (jsdom) has no
			// such bundler, so alias it to an in-tree empty stub.
			'server-only': path.resolve(__dirname, './src/test/server-only-shim.ts'),
		},
	},
});
