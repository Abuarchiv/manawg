// dismissOnboarding returns only after the WG shell has rendered.
// Why: An absent access-denied alert is also true before hydration, so the helper must wait for the shell.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('dismissOnboarding', () => {
	skipUnlessFixtures();

	test('waits for the WG shell before returning', async ({ page }) => {
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);
		expect(await page.locator('[data-bottom-nav-item]').count()).toBeGreaterThan(0);
	});
});
