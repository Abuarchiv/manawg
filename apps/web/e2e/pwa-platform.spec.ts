import { expect, test } from '@playwright/test';
import { isIosLikeDevice } from '../src/shared/lib/pwa-install';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test('iPadOS desktop Safari is treated as an iOS-like device', () => {
	expect(
		isIosLikeDevice({
			userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
			platform: 'MacIntel',
			maxTouchPoints: 5,
		}),
	).toBe(true);
	expect(
		isIosLikeDevice({
			userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
			platform: 'MacIntel',
			maxTouchPoints: 0,
		}),
	).toBe(false);
});

async function fireInstallEvent(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		const event = Object.assign(new Event('beforeinstallprompt'), {
			prompt: async () => {},
			userChoice: Promise.resolve({ outcome: 'dismissed' }),
		});
		window.dispatchEvent(event);
	});
}

test('install prompt returns on every app start until dismissed for the session', async ({
	page,
	context,
}) => {
	await page.goto('/');
	await fireInstallEvent(page);
	const install = page.getByRole('button', { name: 'Jetzt installieren', exact: true });
	await expect(install).toBeVisible();

	await page.getByRole('button', { name: 'Installationshinweis ausblenden' }).click();
	await expect(install).toHaveCount(0);
	await page.reload();
	await fireInstallEvent(page);
	await page.waitForTimeout(1500);
	await expect(install).toHaveCount(0);

	const nextStart = await context.newPage();
	await nextStart.goto('/');
	await fireInstallEvent(nextStart);
	await expect(
		nextStart.getByRole('button', { name: 'Jetzt installieren', exact: true }),
	).toBeVisible();
});

test('browsers without a native prompt get the manual install steps', async ({ page }) => {
	await page.addInitScript(() => {
		// biome-ignore lint/performance/noDelete: simulate a browser without the API
		delete (window as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'So installierst du ManaWG', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'ManaWG als App installieren' })).toBeVisible();
});

test('WG install prompt stays above and does not block the bottom navigation', async ({
	page,
}, testInfo) => {
	await setupMember(page);
	await page.addInitScript(() => {
		// biome-ignore lint/performance/noDelete: simulate a browser without the API
		delete (window as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
	});
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
	await dismissOnboarding(page);

	const prompt = page.locator('section[aria-label="App installieren"]');
	await expect(prompt).toBeVisible();
	await expect(prompt.getByRole('button', { name: 'So installierst du ManaWG' })).toBeVisible();
	const card = prompt.locator('[data-slot="card"]');
	await expect(card).toBeVisible();
	const bottomNav = page.getByRole('navigation', { name: 'WG Hauptnavigation' });
	for (const label of ['Start', 'Haushalt', 'Finanzen', 'Austausch']) {
		await expect(bottomNav.getByRole('link', { name: label })).toBeVisible();
	}

	// Let the 220 ms entrance animation settle before measuring final hit regions.
	await page.waitForTimeout(250);
	const measurements: Array<{
		width: number;
		theme: 'light' | 'dark';
		cardBottom: number;
		navTop: number;
		gap: number;
		navItemHeights: number[];
	}> = [];
	for (const theme of ['light', 'dark'] as const) {
		for (const width of [320, 390]) {
			await page.setViewportSize({ width, height: 844 });
			await page.emulateMedia({ colorScheme: theme });
			const [cardBox, navBox, navItemHeights] = await Promise.all([
				card.boundingBox(),
				bottomNav.boundingBox(),
				bottomNav
					.getByRole('link')
					.evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height)),
			]);
			expect(cardBox).not.toBeNull();
			expect(navBox).not.toBeNull();
			if (!cardBox || !navBox)
				throw new Error('Prompt card or bottom navigation is not measurable');
			measurements.push({
				width,
				theme,
				cardBottom: cardBox.y + cardBox.height,
				navTop: navBox.y,
				gap: navBox.y - (cardBox.y + cardBox.height),
				navItemHeights,
			});
			expect(navItemHeights.length).toBe(4);
			expect(navItemHeights.every((height) => height >= 44)).toBe(true);
			for (const label of ['Start', 'Haushalt', 'Finanzen', 'Austausch']) {
				await bottomNav.getByRole('link', { name: label }).click({ trial: true });
			}
			await page.screenshot({
				path: testInfo.outputPath(`wg-install-${width}-${theme}.png`),
				animations: 'disabled',
			});
		}
	}
	await testInfo.attach('pwa-bottom-nav-bounds.json', {
		body: JSON.stringify(measurements, null, 2),
		contentType: 'application/json',
	});
	expect(measurements.filter((measurement) => measurement.gap < 0)).toEqual([]);
});
