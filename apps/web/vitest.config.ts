import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

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
					exclude: ['e2e/**', 'node_modules/**', '.next/**', 'src/app/api/**'],
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
