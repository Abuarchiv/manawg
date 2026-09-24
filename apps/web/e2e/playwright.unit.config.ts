import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '..',
	testMatch: [
		'e2e/expense-create-replay-atomic.spec.ts',
		'e2e/expense-integrity-regressions.spec.ts',
		'e2e/inventory-consume-regression.spec.ts',
		'e2e/inventory-save-regression.spec.ts',
		'e2e/notification-dispatch-contract.spec.ts',
		'e2e/rate-limit-fail-open-env.spec.ts',
		'e2e/rate-limit-fail-open-stats.spec.ts',
		'e2e/shopping-mutation-regression.spec.ts',
		'e2e/upload-sign-s3-config-contract.spec.ts',
	],
	reporter: 'line',
	workers: 1,
});
