// craftsman-ignore: TS002
import { defineConfig, devices } from '@playwright/test';

const DEFAULT_E2E_PORT = process.env.E2E_PORT ?? '3101';
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${DEFAULT_E2E_PORT}`;
const parsedBaseUrl = new URL(BASE_URL);
const isLocalBase = ['localhost', '127.0.0.1', '::1'].includes(parsedBaseUrl.hostname);
const isRemoteBase = /^https?:\/\//i.test(BASE_URL) && !isLocalBase;
const serverPort = parsedBaseUrl.port || (parsedBaseUrl.protocol === 'https:' ? '443' : '80');
const APP_DIR = process.cwd().endsWith('/apps/web') ? process.cwd() : 'apps/web';
const useBuiltServer = process.env.PLAYWRIGHT_USE_BUILD === 'true';
const e2eDistDir = `.next-e2e-${serverPort}`;
const e2eTsconfigPath = `.next-e2e-tsconfig-${serverPort}.json`;
const isolatedNextEnv = `NEXT_DIST_DIR=${e2eDistDir} NEXT_TSCONFIG_PATH=${e2eTsconfigPath}`;
const prepareIsolatedNext = `cp tsconfig.json ${e2eTsconfigPath}`;
const webServerCommand = useBuiltServer
	? `${prepareIsolatedNext} && CI=true E2E_FIXTURE_MODE=true NEXT_PUBLIC_E2E_FIXTURE_MODE=true NEXT_PUBLIC_DB_DOWN=true POSTGRES_URL= DATABASE_URL= VERCEL_ENV=development ${isolatedNextEnv} pnpm exec next build && CI=true E2E_FIXTURE_MODE=true NEXT_PUBLIC_E2E_FIXTURE_MODE=true NEXT_PUBLIC_DB_DOWN=true POSTGRES_URL= DATABASE_URL= VERCEL_ENV=development ${isolatedNextEnv} pnpm exec next start --port ${serverPort}`
	: process.env.NEXT_PUBLIC_DB_DOWN === 'true'
		? `${prepareIsolatedNext} && CI=true E2E_FIXTURE_MODE=true NEXT_PUBLIC_E2E_FIXTURE_MODE=true NEXT_PUBLIC_DB_DOWN=true POSTGRES_URL= DATABASE_URL= VERCEL_ENV=development ${isolatedNextEnv} pnpm exec next dev --port ${serverPort}`
		: `${prepareIsolatedNext} && if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi; VERCEL_ENV=development ${isolatedNextEnv} pnpm exec next dev --port ${serverPort}`;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: [['html', { open: 'never' }], ['list']],
	workers: 1,
	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		// Pinned for the same reason the unit suite pins TZ: without it the
		// browser inherits the host's timezone and locale, so assertions on
		// rendered dates and amounts pass in CET and fail in CI's UTC. These
		// are the settings the app is actually built for.
		timezoneId: 'Europe/Berlin',
		locale: 'de-DE',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	// Skip local dev server when running against a remote BASE_URL (e.g. preview/prod).
	webServer: isRemoteBase
		? undefined
		: {
				command: webServerCommand,
				cwd: APP_DIR,
				url: BASE_URL,
				reuseExistingServer: false,
				timeout: 180_000,
			},
});
