// Forced colors: the selected tab, segment and sub-nav link stay distinguishable from their siblings.
// Why: forced colors drops background fills, rings and shadows, which are the only selected-state cue.

import { expect, type Locator, type Page, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

test.describe('forced colors selected state', () => {
	skipUnlessFixtures();

	async function backgroundOf(target: Locator): Promise<string> {
		return target.evaluate((element) => getComputedStyle(element).backgroundColor);
	}

	async function highlightColor(page: Page): Promise<string> {
		return page.evaluate(() => {
			const sample = document.createElement('span');
			sample.style.backgroundColor = 'Highlight';
			document.body.append(sample);
			const color = getComputedStyle(sample).backgroundColor;
			sample.remove();
			return color;
		});
	}

	async function expectSelectedFilled(page: Page, selected: Locator, sibling: Locator) {
		await expect(selected).toBeVisible();
		await expect(sibling).toBeVisible();
		const highlight = await highlightColor(page);
		await expect.poll(() => backgroundOf(selected)).toBe(highlight);
		expect(await backgroundOf(sibling)).not.toBe(highlight);
		const textOnHighlight = await selected.evaluate((element) => getComputedStyle(element).color);
		const highlightText = await page.evaluate(() => {
			const sample = document.createElement('span');
			sample.style.color = 'HighlightText';
			document.body.append(sample);
			const color = getComputedStyle(sample).color;
			sample.remove();
			return color;
		});
		expect(textOnHighlight).toBe(highlightText);
	}

	test.beforeEach(async ({ page }) => {
		await setupMember(page);
		await page.emulateMedia({ forcedColors: 'active' });
	});

	test('fills the selected settings tab and appearance segment', async ({ page }) => {
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/settings#profile`);
		await expectSelectedFilled(
			page,
			page.locator('[role="tab"][aria-selected="true"]'),
			page.locator('[role="tab"][aria-selected="false"]').first(),
		);
		await expectSelectedFilled(
			page,
			page.locator('[data-variant="segmented"][aria-pressed="true"]').first(),
			page.locator('[data-variant="segmented"][aria-pressed="false"]').first(),
		);
	});

	test('fills the selected calendar view tab and the active sub-nav link', async ({ page }) => {
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
		await expectSelectedFilled(
			page,
			page.locator('[role="tab"][aria-selected="true"]'),
			page.locator('[role="tab"][aria-selected="false"]').first(),
		);
		const subNav = page.locator('main nav ul');
		await expectSelectedFilled(
			page,
			subNav.locator('a[aria-current]'),
			subNav.locator('a:not([aria-current])').first(),
		);
	});
});
