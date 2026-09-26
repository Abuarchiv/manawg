import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

const queuedAction = {
	id: `shopping:${FIXTURE_WG.shareCode}:responsive-test`,
	idempotencyKey: '11111111-1111-4111-8111-111111111111',
	type: 'shopping.create',
	wgId: FIXTURE_WG.id,
	shareCode: FIXTURE_WG.shareCode,
	memberId: FIXTURE_WG.memberId,
	createdAt: '2026-09-25T10:00:00.000Z',
	payload: { name: 'Milch', quantity: '1L' },
};

const width = 320;
for (const colorScheme of ['light', 'dark'] as const) {
	for (const textScale of ['normal', '32px'] as const) {
		test(`offline retry fits ${width}px ${colorScheme} ${textScale}`, async ({ page }) => {
			await page.setViewportSize({ width, height: 844 });
			await page.emulateMedia({ colorScheme });
			await setupMember(page);
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#daten`);
			await expect(page.getByRole('heading', { name: 'Offline-Warteschlange' })).toBeVisible({
				timeout: 30_000,
			});
			const html = page.locator('html');
			if (colorScheme === 'dark') await expect(html).toHaveClass(/dark/);
			else await expect(html).not.toHaveClass(/dark/);
			await page.evaluate((action) => {
				localStorage.setItem('manawg:offline-actions', JSON.stringify([action]));
				window.dispatchEvent(new Event('manawg:offline-queue'));
			}, queuedAction);

			if (textScale === '32px') {
				await page.evaluate(() => {
					document.documentElement.style.fontSize = '200%';
				});
				expect(await html.evaluate((element) => getComputedStyle(element).fontSize)).toBe('32px');
			}

			const section = page.getByRole('region', { name: 'Offline-Warteschlange' });
			const retry = section.getByRole('button', {
				name: 'Offline-Warteschlange erneut synchronisieren',
			});
			await expect(retry).toBeEnabled();
			const bounds = await retry.locator('xpath=..').evaluate((row) => {
				const status = row.querySelector('p');
				const button = row.querySelector('button');
				if (!status || !button) throw new Error('Retry row is missing status or button');
				return {
					statusLeft: status.getBoundingClientRect().left,
					statusRight: status.getBoundingClientRect().right,
					buttonLeft: button.getBoundingClientRect().left,
					buttonRight: button.getBoundingClientRect().right,
				};
			});

			expect(bounds.statusLeft).toBeGreaterThanOrEqual(-1);
			expect(bounds.statusRight).toBeLessThanOrEqual(width + 1);
			expect(bounds.buttonLeft).toBeGreaterThanOrEqual(-1);
			expect(bounds.buttonRight).toBeLessThanOrEqual(width + 1);
			if (colorScheme === 'dark' && textScale === '32px') {
				await retry.scrollIntoViewIfNeeded();
				await page.screenshot({
					path: test.info().outputPath('offline-retry-320-dark-32.png'),
				});
			}
		});
	}
}
