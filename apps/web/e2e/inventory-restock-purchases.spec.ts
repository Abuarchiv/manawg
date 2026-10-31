import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('purchase restock decisions', () => {
	skipUnlessFixtures();

	for (const decision of ['restock', 'dismiss'] as const) {
		for (const reuseItem of [false, true]) {
			test(`${decision} applies to one purchase and allows ${reuseItem ? 'a retoggled item' : 'a new shopping item'}`, async ({
				page,
			}) => {
				const itemId = '11111111-1111-4111-8111-111111111111';
				const firstPurchaseId = '22222222-2222-4222-8222-222222222222';
				let purchaseId = firstPurchaseId;
				let showCurrent = true;
				let showFirst = false;
				const firstBoughtAt = new Date(Date.now() - 300_000).toISOString();
				let boughtAt = firstBoughtAt;
				let quantity = 0;
				let writes = 0;
				const item = () => ({
					id: itemId,
					wgId: FIXTURE_WG.id,
					name: 'Milch',
					quantity,
					threshold: 0,
					unit: 'pack',
					category: 'kitchen',
					lastDecrementedAt: firstBoughtAt,
					decrementCount30d: 1,
					createdAt: firstBoughtAt,
					updatedAt: new Date().toISOString(),
				});
				await setupMember(page);
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory`, (route) =>
					route.fulfill({ json: { items: [item()] } }),
				);
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory/${itemId}`, (route) => {
					expect(route.request().postDataJSON()).toMatchObject({
						purchase: { id: purchaseId, boughtAt },
					});
					writes += 1;
					quantity += route.request().postDataJSON().quantityDelta;
					return route.fulfill({ json: { item: item() } });
				});
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, (route) =>
					route.fulfill({
						json: {
							items: [
								...(showCurrent
									? [
											{
												id: purchaseId,
												addedByMemberId: FIXTURE_WG.memberId,
												name: 'Milch',
												quantity: '1 Packung',
												boughtAt,
												boughtByMemberId: FIXTURE_WG.memberId,
												createdAt: firstBoughtAt,
											},
										]
									: []),
								...(showFirst
									? [
											{
												id: firstPurchaseId,
												addedByMemberId: FIXTURE_WG.memberId,
												name: 'Milch',
												quantity: '1 Packung',
												boughtAt: firstBoughtAt,
												boughtByMemberId: FIXTURE_WG.memberId,
												createdAt: firstBoughtAt,
											},
										]
									: []),
							],
						},
					}),
				);
				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
				await dismissOnboarding(page);
				const restock = page.getByRole('button', { name: 'Milch: Vorrat erhöhen', exact: true });
				await expect(restock).toBeVisible();
				if (decision === 'restock') {
					await restock.click();
					await expect.poll(() => writes).toBe(1);
				} else {
					await page.getByRole('button', { name: 'Milch: Nicht jetzt', exact: true }).click();
				}
				await expect(restock).toHaveCount(0);
				quantity = 0;
				await page.reload();
				await page.waitForLoadState('networkidle');
				await expect(restock).toHaveCount(0);
				expect(writes).toBe(decision === 'restock' ? 1 : 0);
				boughtAt = new Date(Date.now() - 60_000).toISOString();
				if (!reuseItem) {
					purchaseId = '33333333-3333-4333-8333-333333333333';
					showFirst = true;
				}
				await page.reload();
				await expect(restock).toBeVisible();
				await restock.click();
				await expect.poll(() => writes).toBe(decision === 'restock' ? 2 : 1);
				await expect(restock).toHaveCount(0);
				if (!reuseItem) {
					quantity = 0;
					showCurrent = false;
					await page.reload();
					await page.waitForLoadState('networkidle');
					await expect(restock).toHaveCount(0);
				}
			});
		}
	}
});
