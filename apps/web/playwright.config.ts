import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { assertPreviewOrigin } from './scripts/release-workflow-gates.mjs';

const DEFAULT_E2E_PORT = process.env.E2E_PORT ?? '3101';
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${DEFAULT_E2E_PORT}`;
const previewE2E = process.env.PREVIEW_E2E === 'true';
const automationBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
if (previewE2E) {
	if (!automationBypassSecret)
		throw new Error('PREVIEW_E2E requires VERCEL_AUTOMATION_BYPASS_SECRET.');
	assertPreviewOrigin(BASE_URL);
}

let previewStorageState: string | undefined;
if (previewE2E) {
	previewStorageState = process.env.MANAWG_PREVIEW_AUTH_STATE;
	if (!previewStorageState) {
		previewStorageState = path.join(
			mkdtempSync(path.join(tmpdir(), 'manawg-preview-auth-')),
			'state.json',
		);
		process.env.MANAWG_PREVIEW_AUTH_STATE = previewStorageState;
	}
}
const parsedBaseUrl = new URL(BASE_URL);
const isLocalBase = ['localhost', '127.0.0.1', '::1'].includes(parsedBaseUrl.hostname);
const isRemoteBase = /^https?:\/\//i.test(BASE_URL) && !isLocalBase;
const serverPort = parsedBaseUrl.port || (parsedBaseUrl.protocol === 'https:' ? '443' : '80');
const APP_DIR = import.meta.dirname;
const useBuiltServer = process.env.PLAYWRIGHT_USE_BUILD === 'true';
const isFixtureServer =
	!isRemoteBase && (useBuiltServer || process.env.NEXT_PUBLIC_DB_DOWN === 'true');
// The auth UI specs need the browser client to be configured, which Next inlines at build time.
// They run on a second fixture server whose Supabase project is the server's own origin; the
// specs answer its /auth/v1 and /api/auth requests through page routes. Every other spec runs
// against the first server, where the browser client is unconfigured.
const AUTH_UI_SPEC = /auth-ui\.spec\.ts$/;
const authUiPort = String(Number(serverPort) + 1000);
const authUiUrl = `http://localhost:${authUiPort}`;
const FAKE_SUPABASE_KEY = 'auth-ui-fixture-key';
// Fixture servers never reach a real storage bucket, whatever the local .env files hold.
if (isFixtureServer) process.env.SUPABASE_STORAGE_BUCKET = '';
const prepareIsolatedNext = (port: string) =>
	`cp "${path.join(APP_DIR, 'tsconfig.json')}" ".next-e2e-tsconfig-${port}.json"`;
const fixtureEnv = (port: string, supabaseEnv: string) =>
	`CI=true E2E_FIXTURE_MODE=true NEXT_PUBLIC_E2E_FIXTURE_MODE=true NEXT_PUBLIC_DB_DOWN=true POSTGRES_URL= DATABASE_URL= ${supabaseEnv} UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= VERCEL= VERCEL_ENV=preview NEXT_DIST_DIR=.next-e2e-${port} NEXT_TSCONFIG_PATH=.next-e2e-tsconfig-${port}.json`;
function fixtureServerCommand(port: string, supabaseEnv: string): string {
	const env = fixtureEnv(port, supabaseEnv);
	return useBuiltServer
		? `${prepareIsolatedNext(port)} && ${env} pnpm exec next build && ${env} pnpm exec next start --port ${port}`
		: `${prepareIsolatedNext(port)} && ${env} pnpm exec next dev --port ${port}`;
}
const unconfiguredSupabase = 'NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=';
const webServerCommand = isFixtureServer
	? fixtureServerCommand(serverPort, unconfiguredSupabase)
	: `${prepareIsolatedNext(serverPort)} && if [ "\${CI:-}" != "true" ] && [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi; VERCEL_ENV=development NEXT_DIST_DIR=.next-e2e-${serverPort} NEXT_TSCONFIG_PATH=.next-e2e-tsconfig-${serverPort}.json pnpm exec next dev --port ${serverPort}`;
const webServer = (command: string, url: string) => ({
	command,
	cwd: APP_DIR,
	url,
	reuseExistingServer: false,
	timeout: 180_000,
});

export default defineConfig({
	...(previewE2E ? { globalSetup: path.join(APP_DIR, 'e2e/support/preview-global-setup.ts') } : {}),
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: [['html', { open: 'never' }], ['list']],
	workers: 1,
	timeout: previewE2E ? 60_000 : 30_000,
	use: {
		baseURL: BASE_URL,
		...(previewStorageState ? { storageState: previewStorageState } : {}),
		// Pace live UI actions to respect the real shared per-IP rate limits.
		...(previewE2E ? { launchOptions: { slowMo: 500 } } : {}),
		trace: previewE2E ? 'off' : 'on-first-retry',
		screenshot: previewE2E ? 'off' : 'only-on-failure',
		// Pin timezone and locale so assertions on rendered dates and amounts
		// pass in CET and do not fail in CI's UTC. These
		// are the settings the app is actually built for.
		timezoneId: 'Europe/Berlin',
		locale: 'de-DE',
	},
	// The auth UI specs only run on their own server; no other project picks them up.
	testIgnore: AUTH_UI_SPEC,
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		...(isFixtureServer
			? [
					{
						name: 'chromium-auth-ui',
						testIgnore: [],
						testMatch: AUTH_UI_SPEC,
						use: { ...devices['Desktop Chrome'], baseURL: authUiUrl },
					},
				]
			: []),
	],
	// Skip local dev server when running against a remote BASE_URL (e.g. preview/prod).
	...(isRemoteBase
		? {}
		: {
				webServer: [
					webServer(webServerCommand, BASE_URL),
					...(isFixtureServer
						? [
								webServer(
									fixtureServerCommand(
										authUiPort,
										`NEXT_PUBLIC_SUPABASE_URL=${authUiUrl} NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${FAKE_SUPABASE_KEY}`,
									),
									authUiUrl,
								),
							]
						: []),
				],
			}),
});
