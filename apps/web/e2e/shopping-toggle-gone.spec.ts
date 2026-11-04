// Checking off a shopping item that another member already deleted.
// Why: the list must drop the row once the server reports it gone; a row kept in the pending
// overlay would sit under "Erledigt" and offer a receipt for an item the server does not have.

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const milk = {
	id: 'shopping-milk',
	addedByMemberId: FIXTURE_WG.memberId,
	name: 'Milch',
	quantity: null,
	boughtAt: null,
	boughtByMemberId: null,
	createdAt: '2026-09-22T10:00:00.000Z',
	updatedAt: '2026-09-22T10:00:00.000Z',
};

async function openShopping(page: Page, items: (typeof milk)[]) {
	const { shareCode, memberId, memberName } = FIXTURE_WG;
	await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
		route.fulfill({
			json: { members: [{ id: memberId, name: memberName, active: true }], viewerIsAdmin: false },
		}),
	);
	await page.route(`**/api/wg/${shareCode}/inventory*`, (route) =>
		route.fulfill({ json: { items: [] } }),
	);
	await page.route(new RegExp(`/api/wg/${shareCode}/shopping(?:\\?.*)?$`), (route) =>
		route.request().method() === 'GET' ? route.fulfill({ json: { items } }) : route.fallback(),
	);
	await setupMember(page);
	await navigateToFeature(page, `/wg/${shareCode}/shopping`);
	await dismissOnboarding(page);
}

test.describe('shopping toggle on a deleted item', () => {
	test('an item deleted elsewhere is gone from the list, not parked under Erledigt', async ({
		page,
	}) => {
		skipUnlessFixtures();
		const { shareCode } = FIXTURE_WG;
		const server = [milk];
		let patches = 0;
		await page.route(new RegExp(`/api/wg/${shareCode}/shopping/${milk.id}(?:\\?.*)?$`), (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			patches += 1;
			server.length = 0;
			return route.fulfill({ status: 404, json: { error: 'item_not_found' } });
		});
		await openShopping(page, server);
		await page.getByRole('checkbox', { name: 'Milch erledigen' }).click();
		await expect.poll(() => patches).toBe(1);
		await expect(page.getByText('Dieser Einkaufsartikel existiert nicht mehr')).toBeVisible();
		await expect(page.getByText(/^Erledigt \(/)).toHaveCount(0);
		await expect(page.getByText('Beleg für 1 Artikel')).toHaveCount(0);
	});
});
