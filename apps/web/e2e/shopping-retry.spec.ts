import { expect, test } from '@playwright/test';
import { dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.setTimeout(240_000);

test('requires a WG member for shopping API data', async ({ request }) => {
	const response = await request.get('/api/wg/MTE8PZAT/shopping', {
		timeout: 120_000,
	});

	expect(response.status()).toBe(401);
	await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
});

test('retries an uncertain shopping create with the same idempotency key', async ({ page }) => {
	test.skip(
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
		'requires the local fixture server',
	);
	const keys: string[] = [];
	await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue();
			return;
		}
		keys.push(route.request().headers()['idempotency-key']);
		await route.fulfill({
			status: keys.length === 1 ? 503 : 200,
			contentType: 'application/json',
			body: JSON.stringify(
				keys.length === 1
					? { error: 'idempotency_response_pending' }
					: {
							item: {
								id: 'replayed-shopping-item',
								name: 'Rettich',
								quantity: null,
								addedByMemberId: 'fixture-member',
								boughtAt: null,
								boughtByMemberId: null,
								createdAt: new Date().toISOString(),
							},
							warning: null,
						},
			),
		});
	});
	await setupMember(page);
	await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
	await dismissOnboarding(page);
	await page.getByLabel('Artikel-Name').fill('Rettich');
	await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
	await expect(
		page.getByText('Speicherstatus unklar. Prüfe die Liste und versuche es bei Bedarf erneut.'),
	).toBeVisible();
	await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
	await expect.poll(() => keys.length).toBe(2);
	expect(keys[0]).toBeTruthy();
	expect(keys[1]).toBe(keys[0]);
});
