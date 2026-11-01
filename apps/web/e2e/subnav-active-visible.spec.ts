// The sub-navigation scrolls the active tab into view when large text makes the list overflow.
// Why: the list hides its scrollbar, so a clipped active tab leaves no cue where the user is.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';
import { setEnglishLocale } from './support/i18n';

test.describe('sub-navigation active tab visibility', () => {
	skipUnlessFixtures();

	test.use({ viewport: { width: 390, height: 844 } });

	for (const [language, slug] of [
		['de', 'calendar'],
		['de', 'supplies'],
		['en', 'calendar'],
		['en', 'shopping'],
	] as const) {
		test(`keeps the active ${language} ${slug} tab inside the list at 200% text`, async ({
			page,
			context,
			baseURL,
		}) => {
			if (language === 'en') await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
			await setupMember(page);
			await page.addInitScript(() => {
				// The root element does not exist yet when the script runs, so wait for it.
				new MutationObserver((_records, observer) => {
					if (!document.documentElement) return;
					document.documentElement.style.setProperty('font-size', '200%', 'important');
					observer.disconnect();
				}).observe(document, { childList: true });
			});
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/${slug}`);

			const active = page.locator('[data-slot="subnav-link"][aria-current]').first();
			await expect(active).toBeVisible();
			const list = active.locator('xpath=ancestor::ul[1]');
			await expect
				.poll(async () => {
					const a = await active.boundingBox();
					const l = await list.boundingBox();
					if (!a || !l) return false;
					return a.x >= l.x - 1 && a.x + a.width <= l.x + l.width + 1;
				})
				.toBe(true);
		});
	}
});
