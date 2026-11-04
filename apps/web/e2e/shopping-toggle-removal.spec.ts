// Shopping check-off, removal and clear-bought outcomes.
// Why: the toggle and removal hooks decide what the list shows after each server answer; a wrong
// branch leaves a checked row that the server never saved, or a row that is already gone.

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

type Item = {
	id: string;
	addedByMemberId: string;
	name: string;
	quantity: string | null;
	boughtAt: string | null;
	boughtByMemberId: string | null;
	createdAt: string;
	updatedAt: string;
};

const milk: Item = {
	id: 'shopping-milk',
	addedByMemberId: FIXTURE_WG.memberId,
	name: 'Milch',
	quantity: null,
	boughtAt: null,
	boughtByMemberId: null,
	createdAt: '2026-09-22T10:00:00.000Z',
	updatedAt: '2026-09-22T10:00:00.000Z',
};
const coffee: Item = {
	...milk,
	id: 'shopping-coffee',
	name: 'Kaffee',
	boughtAt: '2026-09-22T12:00:00.000Z',
	boughtByMemberId: FIXTURE_WG.memberId,
	updatedAt: '2026-09-22T12:00:00.000Z',
};

async function openShopping(page: Page, items: Item[], viewerIsAdmin = false) {
	const { shareCode, memberId, memberName } = FIXTURE_WG;
	await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
		route.fulfill({
			json: { members: [{ id: memberId, name: memberName, active: true }], viewerIsAdmin },
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

test.describe('shopping toggle outcomes', () => {
	test('a rejected check-off puts the row back and a final answer releases its key', async ({
		page,
	}) => {
		skipUnlessFixtures();
		const { shareCode } = FIXTURE_WG;
		const answers = [
			{ status: 500, json: { error: 'server_error' } },
			{ status: 409, json: { error: 'shopping_item_changed' } },
			{ status: 503, json: { error: 'service_unavailable' } },
		];
		const keys: string[] = [];
		await page.route(new RegExp(`/api/wg/${shareCode}/shopping/${milk.id}(?:\\?.*)?$`), (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			keys.push(route.request().headers()['idempotency-key'] ?? '');
			const answer = answers[keys.length - 1];
			if (!answer) throw new Error('unexpected PATCH');
			return route.fulfill(answer);
		});
		await openShopping(page, [milk]);

		const open = page.getByRole('checkbox', { name: 'Milch erledigen' });
		await open.click();
		await expect.poll(() => keys.length).toBe(1);
		// A server error is not saved: the row is unchecked again and the failure is explained.
		await expect(open).not.toBeChecked();
		await expect(page.getByText('Erledigt (1)', { exact: true })).toHaveCount(0);

		await open.click();
		await expect.poll(() => keys.length).toBe(2);
		await expect(page.getByText('Der Einkaufsstatus hat sich geändert.')).toBeVisible();
		await expect(open).not.toBeChecked();
		await expect(page.getByText('Erledigt (1)', { exact: true })).toHaveCount(0);
		// A 5xx answer is unclear and keeps its key; the 409 before this tap was final, so it must not be replayed.
		expect(keys[1]).toBe(keys[0]);
		await open.click();
		await expect.poll(() => keys.length).toBe(3);
		expect(keys[2]).not.toBe(keys[1]);
	});

	test('an uncertain answer keeps the idempotency key for the retry', async ({ page }) => {
		skipUnlessFixtures();
		const { shareCode } = FIXTURE_WG;
		const keys: string[] = [];
		await page.route(new RegExp(`/api/wg/${shareCode}/shopping/${milk.id}(?:\\?.*)?$`), (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			keys.push(route.request().headers()['idempotency-key'] ?? '');
			return keys.length === 1
				? route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
				: route.fulfill({
						json: {
							item: {
								...milk,
								boughtAt: '2026-09-22T13:00:00.000Z',
								boughtByMemberId: FIXTURE_WG.memberId,
								updatedAt: '2026-09-22T13:00:00.000Z',
							},
						},
					});
		});
		await openShopping(page, [milk]);
		const open = page.getByRole('checkbox', { name: 'Milch erledigen' });
		await open.click();
		await expect.poll(() => keys.length).toBe(1);
		await expect(open).not.toBeChecked();
		await open.click();
		await expect.poll(() => keys.length).toBe(2);
		expect(keys[1]).toBe(keys[0]);
	});
});

test.describe('shopping removal outcomes', () => {
	test('clearing bought items drops only the bought rows, then reloads the list', async ({
		page,
	}) => {
		skipUnlessFixtures();
		const { shareCode } = FIXTURE_WG;
		const server = [milk, coffee];
		let gets = 0;
		let releaseReload: () => void = () => {};
		const reloadGate = new Promise<void>((resolve) => {
			releaseReload = resolve;
		});
		let cleared = false;
		await page.route(new RegExp(`/api/wg/${shareCode}/shopping(?:\\?.*)?$`), async (route) => {
			const method = route.request().method();
			if (method === 'DELETE') {
				cleared = true;
				server.splice(0, server.length, milk);
				return route.fulfill({ json: { deleted: 1 } });
			}
			if (method !== 'GET') return route.fallback();
			gets += 1;
			if (cleared) await reloadGate;
			return route.fulfill({ json: { items: server } });
		});
		await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
			route.fulfill({
				json: {
					members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, active: true }],
					viewerIsAdmin: true,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/inventory*`, (route) =>
			route.fulfill({ json: { items: [] } }),
		);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${shareCode}/shopping`);
		await dismissOnboarding(page);
		await page.getByText('Erledigt (1)', { exact: true }).click();
		const getsBefore = gets;
		await page.getByRole('button', { name: 'Erledigte entfernen (1 Artikel)' }).click();
		await page.getByRole('button', { name: 'Entfernen', exact: true }).click();
		// Before the reload answers, the list already shows what the server kept.
		await expect(page.getByRole('checkbox', { name: 'Milch erledigen' })).toBeVisible();
		await expect(page.getByText('Kaffee')).toHaveCount(0);
		releaseReload();
		await expect.poll(() => gets).toBeGreaterThan(getsBefore);
	});

	test('removing an item the server no longer has drops it without a second request', async ({
		page,
	}) => {
		skipUnlessFixtures();
		const { shareCode } = FIXTURE_WG;
		let deletes = 0;
		await page.route(new RegExp(`/api/wg/${shareCode}/shopping/${milk.id}(?:\\?.*)?$`), (route) => {
			if (route.request().method() !== 'DELETE') return route.fallback();
			deletes += 1;
			return route.fulfill({ status: 404, json: { error: 'item_not_found' } });
		});
		await openShopping(page, [milk]);
		await page.getByRole('button', { name: 'Artikelaktionen: Milch' }).click();
		await page.getByRole('button', { name: /entfernen: Milch$/ }).click();
		await page.getByRole('button', { name: 'Endgültig entfernen: Milch' }).click();
		await expect.poll(() => deletes).toBe(1);
		await expect(page.getByText('Dieser Einkaufsartikel existiert nicht mehr')).toBeVisible();
		await expect(page.getByRole('checkbox', { name: /Milch/ })).toHaveCount(0);
	});

	test('a non-admin removal answered 403 keeps the row and names the reason', async ({ page }) => {
		skipUnlessFixtures();
		const { shareCode } = FIXTURE_WG;
		await page.route(new RegExp(`/api/wg/${shareCode}/shopping/${milk.id}(?:\\?.*)?$`), (route) =>
			route.request().method() === 'DELETE'
				? route.fulfill({ status: 403, json: { error: 'forbidden' } })
				: route.fallback(),
		);
		await openShopping(page, [milk]);
		await page.getByRole('button', { name: 'Artikelaktionen: Milch' }).click();
		await page.getByRole('button', { name: /entfernen: Milch$/ }).click();
		await page.getByRole('button', { name: 'Endgültig entfernen: Milch' }).click();
		await expect(
			page.getByText('Nur wer den Artikel hinzugefügt hat oder ein WG-Admin kann ihn entfernen.'),
		).toBeVisible();
		await expect(page.locator('li', { hasText: 'Milch' })).toHaveCount(1);
	});
});

test.describe('shopping removal and the offline queue', () => {
	for (const answer of [
		{ name: 'deleted', status: 200, json: { deleted: 1 } },
		{ name: 'already gone', status: 404, json: { error: 'item_not_found' } },
	]) {
		test(`removing an item (${answer.name}) discards its queued check-off`, async ({ page }) => {
			skipUnlessFixtures();
			const { shareCode } = FIXTURE_WG;
			let patches = 0;
			await page.route(
				new RegExp(`/api/wg/${shareCode}/shopping/${milk.id}(?:\\?.*)?$`),
				(route) => {
					const method = route.request().method();
					if (method === 'PATCH') {
						patches += 1;
						return route.abort('failed');
					}
					if (method === 'DELETE') return route.fulfill(answer);
					return route.fallback();
				},
			);
			await openShopping(page, [milk]);
			const queued = () =>
				page.evaluate(
					() => JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]').length as number,
				);
			await page.getByRole('checkbox', { name: 'Milch erledigen' }).click();
			await expect.poll(queued).toBe(1);
			expect(patches).toBeGreaterThan(0);

			await page.getByText('Erledigt (1)', { exact: true }).click();
			await page.getByRole('button', { name: 'Artikelaktionen: Milch' }).click();
			await page.getByRole('button', { name: /entfernen: Milch$/ }).click();
			await page.getByRole('button', { name: 'Endgültig entfernen: Milch' }).click();
			// A check-off for a deleted item could only fail on replay.
			await expect.poll(queued).toBe(0);
			await expect(page.locator('[data-offline-banner]')).toHaveCount(0);
		});
	}
});
