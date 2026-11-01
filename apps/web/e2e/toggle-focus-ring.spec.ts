// Focus ring on the selected segment of a segmented toggle.
// Why: The selected segment keeps a resting 1px ring, so the focus ring must override it.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

test.describe('segmented toggle focus ring', () => {
	skipUnlessFixtures();

	for (const colorScheme of ['light', 'dark'] as const) {
		test(`the focused selected segment shows a 3px ring in ${colorScheme} mode`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.emulateMedia({ colorScheme });
			await setupMember(page);
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/expenses`);
			const selected = page.locator('button[aria-pressed="true"]').first();
			await expect(selected).toBeVisible();
			await selected.focus();
			await page.keyboard.press('Shift+Tab');
			await page.keyboard.press('Tab');
			await expect(selected).toBeFocused();
			await expect
				.poll(() => selected.evaluate((el) => getComputedStyle(el).boxShadow))
				.toMatch(/0px 0px 0px 3px/);
		});
	}
});
