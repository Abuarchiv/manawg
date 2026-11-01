import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('shopping retry', () => {
	test.setTimeout(240_000);

	test('requires a WG member for shopping API data', async ({ request }) => {
		const response = await request.get(`/api/wg/${FIXTURE_WG.shareCode}/shopping`, {
			timeout: 120_000,
		});

		expect(response.status()).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
	});

	test('retries an uncertain shopping create with the same idempotency key', async ({ page }) => {
		skipUnlessFixtures();
		const keys: string[] = [];
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}
			keys.push(route.request().headers()['idempotency-key'] ?? '');
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
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
		await dismissOnboarding(page);
		await page.getByLabel('Artikel-Name').fill('Rettich');
		await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
		await expect(
			page.getByText(
				'Konnte nicht hinzugefügt werden. Prüfe kurz die Liste, ob der Artikel schon drin ist, und versuche es noch einmal.',
			),
		).toBeVisible();
		await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
		await expect.poll(() => keys.length).toBe(2);
		expect(keys[0]).toBeTruthy();
		expect(keys[1]).toBe(keys[0]);
	});

	test('queues a second Enter while the first add is saving and ignores a repeated Enter on the same text', async ({
		page,
	}) => {
		skipUnlessFixtures();
		const posted: string[] = [];
		let releaseFirst: () => void = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, async (route) => {
			if (route.request().method() !== 'POST') {
				await route.fallback();
				return;
			}
			const { name } = route.request().postDataJSON() as { name: string };
			posted.push(name);
			if (posted.length === 1) await firstGate;
			await route.fulfill({
				json: {
					item: {
						id: `item-${posted.length}`,
						name,
						quantity: null,
						addedByMemberId: FIXTURE_WG.memberId,
						boughtAt: null,
						boughtByMemberId: null,
						createdAt: new Date().toISOString(),
					},
					warning: null,
				},
			});
		});
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
		await dismissOnboarding(page);
		const input = page.getByLabel('Artikel-Name');
		await input.fill('Milch');
		await input.press('Enter');
		// The second Enter must not fail on the disabled submit button.
		await input.press('Enter');
		await input.fill('Brot');
		await input.press('Enter');
		// The waiting „Brot“ is not queued twice either.
		await input.press('Enter');
		releaseFirst();
		await expect.poll(() => posted).toEqual(['Milch', 'Brot']);
		await expect(input).toHaveValue('');
		expect(posted).toEqual(['Milch', 'Brot']);
	});

	test('keeps the typed item in the stored draft while the create is still in flight', async ({
		page,
	}) => {
		skipUnlessFixtures();
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, async (route) => {
			if (route.request().method() !== 'POST') {
				await route.fallback();
				return;
			}
			// Never answers: the page is reloaded while the request is open.
			await new Promise(() => {});
		});
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
		await dismissOnboarding(page);
		const input = page.getByLabel('Artikel-Name');
		await input.fill('Brot');
		await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
		await expect(input).toHaveValue('');
		// Let React flush the effects that follow the cleared field before reading the draft.
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100))),
		);
		// A killed tab runs no more code, so the stored draft is what survives it.
		const storedName = await page.evaluate(() => {
			const key = Object.keys(window.localStorage).find((k) => k.endsWith(':shopping'));
			const raw = key ? window.localStorage.getItem(key) : null;
			return raw ? (JSON.parse(raw) as { name?: string }).name : null;
		});
		expect(storedName).toBe('Brot');
		await page.unroute(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`);
		await page.reload();
		await expect(page.getByLabel('Artikel-Name')).toHaveValue('Brot');
	});

	test('uses a fresh idempotency key after an offline-queued shopping create', async ({ page }) => {
		skipUnlessFixtures();
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}
			await route.abort('internetdisconnected');
		});
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
		await dismissOnboarding(page);
		const readQueuedKeys = () =>
			page.evaluate(() => {
				const raw = window.localStorage.getItem('manawg:offline-actions');
				const actions = raw
					? (JSON.parse(raw) as Array<{ type: string; idempotencyKey?: string }>)
					: [];
				return actions
					.filter((action) => action.type === 'shopping.create')
					.map((action) => action.idempotencyKey);
			});
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await page.getByLabel('Artikel-Name').fill('Rettich');
			await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
			await expect.poll(async () => (await readQueuedKeys()).length).toBe(attempt + 1);
		}
		const keys = await readQueuedKeys();
		expect(keys[0]).toBeTruthy();
		expect(keys[1]).toBeTruthy();
		expect(keys[1]).not.toBe(keys[0]);
	});
});
