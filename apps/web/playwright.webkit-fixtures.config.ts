import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Only the first fixture server is needed; the auth UI server belongs to the Chromium project.
const [fixtureServer] = [base.webServer ?? []].flat();

export default defineConfig({
	...base,
	projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }],
	...(fixtureServer ? { webServer: fixtureServer } : {}),
	// The fixture API mocks must receive requests instead of the service worker.
	use: { ...base.use, serviceWorkers: 'block' },
});
