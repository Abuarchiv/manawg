import { expect, test } from '@playwright/test';
import { isIosLikeDevice } from '../src/shared/lib/pwa-install';

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
