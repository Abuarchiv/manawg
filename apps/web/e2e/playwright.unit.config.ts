import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '..',
	testMatch: [
		'e2e/inventory-consume-regression.spec.ts',
		'e2e/notification-dispatch-contract.spec.ts',
		'e2e/upload-sign-s3-config-contract.spec.ts',
	],
	reporter: 'line',
	workers: 1,
});
