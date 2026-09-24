import { expect, test } from '@playwright/test';
import { dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
test.use({ hasTouch: true, isMobile: true });

const SHARE_CODE = 'MTE8PZAT';
const shoppingItems = [
	{
		id: 'shopping-oat-milk',
		addedByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		name: 'Ungesüßte Hafermilch',
		quantity: '1 Packung',
		boughtAt: null,
		boughtByMemberId: null,
		createdAt: '2026-09-20T08:00:00.000Z',
	},
];

test('cached shopping content stays visible while a revisit is revalidating', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await setupMember(page);

	let shoppingReads = 0;
	let markSecondReadStarted: () => void = () => {};
	let releaseSecondRead: () => void = () => {};
	const secondReadStarted = new Promise<void>((resolve) => {
		markSecondReadStarted = resolve;
	});
	const secondReadGate = new Promise<void>((resolve) => {
		releaseSecondRead = resolve;
	});

	await page.route(`**/api/wg/${SHARE_CODE}/shopping*`, async (route) => {
		if (route.request().method() !== 'GET') return route.continue();
		shoppingReads += 1;
		if (shoppingReads > 1) {
			markSecondReadStarted();
			await secondReadGate;
		}
		return route.fulfill({ json: { items: shoppingItems } });
	});
	await page.route(`**/api/wg/${SHARE_CODE}/inventory*`, (route) =>
		route.fulfill({ json: { items: [], grouped: {} } }),
	);

	await navigateToFeature(page, `/wg/${SHARE_CODE}/einkauf`);
	await dismissOnboarding(page);
	const item = page.getByRole('checkbox', { name: 'Ungesüßte Hafermilch erledigen' });
	await expect(item).toBeVisible();

	await page.getByRole('link', { name: 'Vorräte' }).click();
	await expect(page.getByRole('heading', { name: 'Vorräte' })).toBeVisible();
	await page.getByRole('link', { name: 'Einkäufe', exact: true }).click();
	await secondReadStarted;

	try {
		await expect(item).toBeVisible({ timeout: 250 });
	} finally {
		releaseSecondRead();
	}
	await expect(item).toBeVisible();
	expect(shoppingReads).toBeGreaterThanOrEqual(2);
});
