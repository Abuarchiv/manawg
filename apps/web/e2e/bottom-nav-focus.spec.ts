// Bottom navigation: keyboard focus stays visible on the active tab.
// Why: The active tab's pill shadow overrides the focus ring, so only an outline can show focus.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('bottom navigation focus', () => {
	skipUnlessFixtures();

	test('draws a focus outline on the active tab', async ({ page }) => {
		const { shareCode } = FIXTURE_WG;
		await setupMember(page);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);

		await navigateToFeature(page, `/wg/${shareCode}`);
		await dismissOnboarding(page);
		const activeTab = page.locator('[data-bottom-nav-item][aria-current]').first();
		await page.keyboard.press('Tab');
		await activeTab.focus();
		await expect(activeTab).toBeFocused();
		await expect(activeTab).toHaveCSS('outline-style', 'solid');
		await expect(activeTab).toHaveCSS('outline-width', '2px');
	});
});
