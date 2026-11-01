// Calendar: deleting an event from the edit drawer leaves keyboard focus inside the page.
// Why: the agenda row is gone, so without a target focus would drop to <body> (WCAG 2.4.3).

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const startsAt = new Date(
	Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 60_000) * 60_000,
).toISOString();
const event = {
	id: '44444444-4444-4444-8444-444444444444',
	title: 'Plenum',
	description: null,
	startsAt,
	endsAt: null,
	allDay: false,
	location: null,
	recurrence: null,
	wgId: FIXTURE_WG.id,
	createdByMemberId: FIXTURE_WG.memberId,
	createdAt: startsAt,
	updatedAt: startsAt,
};

async function openAgenda(page: Page): Promise<void> {
	await setupMember(page);
	let deleted = false;
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
		route.fulfill({ json: { events: deleted ? [] : [event] } }),
	);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events/**`, async (route) => {
		if (route.request().method() === 'DELETE') deleted = true;
		await route.fulfill({ json: route.request().method() === 'DELETE' ? {} : { events: [event] } });
	});
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
		route.fulfill({ json: { chores: [] } }),
	);
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
	await dismissOnboarding(page);
}

const focusIsInsideMain = (page: Page) =>
	page.evaluate(
		() => document.activeElement !== document.body && !!document.activeElement?.closest('main'),
	);

test.describe('calendar focus after closing the edit drawer', () => {
	skipUnlessFixtures();

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		test(`deleting an event keeps focus on the page (${viewport.width}px)`, async ({ page }) => {
			await page.setViewportSize(viewport);
			await openAgenda(page);

			const row = page.getByRole('button', { name: 'Plenum' }).first();
			await row.focus();
			await page.keyboard.press('Enter');
			await page.getByRole('button', { name: 'Termin löschen' }).focus();
			await page.keyboard.press('Enter');
			await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).focus();
			await page.keyboard.press('Enter');

			await expect(page.getByRole('button', { name: 'Plenum' })).toHaveCount(0);
			await expect.poll(() => focusIsInsideMain(page)).toBe(true);
		});
	}

	test('closing the drawer with Escape returns focus to the event row', async ({ page }) => {
		await openAgenda(page);

		const row = page.getByRole('button', { name: 'Plenum' }).first();
		await row.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: 'Termin löschen' })).toBeVisible();
		await page.keyboard.press('Escape');

		await expect(row).toBeFocused();
	});
});
