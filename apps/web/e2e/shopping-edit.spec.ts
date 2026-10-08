// Renaming an open shopping item and changing its amount.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.describe('shopping edit', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const item = {
		id: '4f1d2a8e-6a39-4c0e-9f3e-0b6d1c7a9e11',
		addedByMemberId: FIXTURE_WG.memberId,
		name: 'Hafermich',
		quantity: null,
		boughtAt: null,
		boughtByMemberId: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	test('fixes a typo and sends name and quantity', async ({ page }) => {
		let current = item;
		let putBody: unknown = null;
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { items: [current] } })
				: route.fallback(),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping/${item.id}`, (route) => {
			if (route.request().method() !== 'PUT') return route.fallback();
			putBody = route.request().postDataJSON();
			current = { ...item, name: 'Hafermilch', quantity: '2 Packungen' } as typeof item;
			return route.fulfill({ json: { item: current } });
		});
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Artikelaktionen: Hafermich' }).click();
		await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
		await page.getByLabel('Artikel', { exact: true }).fill('Hafermilch');
		await page.getByLabel('Menge (optional)').fill('2 Packungen');
		await page.getByRole('button', { name: 'Speichern' }).click();

		await expect.poll(() => putBody).toEqual({ name: 'Hafermilch', quantity: '2 Packungen' });
		await expect(page.getByText('Artikel gespeichert.')).toBeVisible();
	});

	test('names a duplicate open item instead of a generic failure', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { items: [item] } })
				: route.fallback(),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping/${item.id}`, (route) =>
			route.request().method() === 'PUT'
				? route.fulfill({ status: 409, json: { error: 'shopping_item_duplicate' } })
				: route.fallback(),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Artikelaktionen: Hafermich' }).click();
		await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
		await page.getByLabel('Artikel', { exact: true }).fill('Milch');
		await page.getByRole('button', { name: 'Speichern' }).click();

		await expect(page.getByText('Diesen Artikel gibt es schon offen auf der Liste.')).toBeVisible();
	});
});
