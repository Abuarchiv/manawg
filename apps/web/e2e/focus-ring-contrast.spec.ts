// Focus ring contrast on controls without a real border.
// Why: WCAG 1.4.11 needs 3:1 for the focus indicator; a ring at 50% opacity only reaches about 2:1.

import { expect, type Locator, type Page, test } from '@playwright/test';
import { sampleBoundaryContrast } from './support/contrast';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

/** Moves focus to the element with the keyboard so :focus-visible applies. */
async function focusByKeyboard(page: Page, target: Locator): Promise<void> {
	await page.keyboard.press('Shift');
	await target.focus();
	await expect(target).toBeFocused();
}

/** Contrast of the focus ring colour (the widest box-shadow layer) against the surface around the element. */
async function focusRingContrast(page: Page, target: Locator): Promise<number | undefined> {
	await target.evaluate((el) => {
		const layers = [
			...getComputedStyle(el).boxShadow.matchAll(/(\w+\([^)]*\))\s0px 0px 0px (\d+)px/g),
		];
		const widest = layers.sort((a, b) => Number(b[2]) - Number(a[2]))[0];
		const ring = widest?.[1] ?? '';
		el.setAttribute('data-ring-probe', '');
		(el as HTMLElement).style.borderTopColor = ring;
	});
	const result = await page.evaluate(sampleBoundaryContrast, {
		selector: '[data-ring-probe]',
		prop: 'borderTopColor' as const,
	});
	return 'ratio' in result ? result.ratio : undefined;
}

test.describe('focus ring contrast', () => {
	skipUnlessFixtures();

	const base = `/wg/${FIXTURE_WG.shareCode}`;
	const targets = [
		{
			name: 'sub navigation link',
			path: `${base}/shopping`,
			locator: (page: Page) =>
				page.locator('[data-slot="subnav-link"]:not([aria-current])').first(),
		},
		{
			name: 'shopping item checkbox',
			path: `${base}/shopping`,
			locator: (page: Page) => page.getByRole('checkbox').first(),
		},
		{
			name: 'unselected toggle segment',
			path: `${base}/expenses`,
			locator: (page: Page) =>
				page.locator('button[aria-pressed="false"]', { hasText: 'Von mir bezahlt' }),
		},
		{
			name: 'news collapsible trigger',
			path: base,
			locator: (page: Page) => page.locator('#wg-now-heading button'),
		},
		{
			name: 'today row link',
			path: base,
			locator: (page: Page) => page.locator('section[aria-labelledby="today-heading"] a').first(),
		},
	];

	for (const colorScheme of ['light', 'dark'] as const) {
		for (const target of targets) {
			test(`${target.name} focus ring has at least 3:1 contrast in ${colorScheme} mode`, async ({
				page,
			}) => {
				await page.setViewportSize({ width: 390, height: 844 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				await navigateToFeature(page, target.path);
				const element = target.locator(page);
				await expect(element).toBeVisible();
				await focusByKeyboard(page, element);
				// The ring fades in, so poll until the colour has settled.
				await expect
					.poll(() => focusRingContrast(page, element), { timeout: 3000 })
					.toBeGreaterThanOrEqual(3);
			});
		}
	}
});
