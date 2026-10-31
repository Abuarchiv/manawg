// Month navigation: the shown month sits in a polite live region that stays mounted.
// Why: screen reader users pressing previous/next otherwise hear nothing about the new month.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const API = `/api/wg/${FIXTURE_WG.shareCode}`;
const PAGE = `/wg/${FIXTURE_WG.shareCode}`;

const monthLabel = (date: Date) =>
	new Intl.DateTimeFormat('de-DE', {
		month: 'long',
		year: 'numeric',
		timeZone: 'Europe/Berlin',
	}).format(date);

test.describe('month navigation announcement', () => {
	skipUnlessFixtures();

	test('calendar month title is a live region that follows the next button', async ({ page }) => {
		await setupMember(page);
		await mockUnreadCount(page, API);
		await page.route(`**${API}/events*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { events: [] } })
				: route.fallback(),
		);
		await page.route(`**${API}/chores*`, (route) => route.fulfill({ json: { chores: [] } }));
		await page.route(`**${API}/calendar-subscription*`, (route) =>
			route.fulfill({ json: { subscription: null } }),
		);
		await navigateToFeature(page, `${PAGE}/calendar`);
		await dismissOnboarding(page);
		await page.getByRole('tab', { name: 'Monat' }).click();
		await expect(page.getByRole('grid')).toBeVisible();

		const now = new Date();
		const [year = 0, month = 0] = new Intl.DateTimeFormat('en-CA', {
			year: 'numeric',
			month: '2-digit',
			timeZone: 'Europe/Berlin',
		})
			.format(now)
			.split('-')
			.map(Number);
		// A mid-month anchor in the month after the Berlin month, safe from UTC/Berlin offsets.
		const next = new Date(Date.UTC(year, month, 15));
		const title = page.locator('[data-slot="card-title"][aria-live="polite"][aria-atomic="true"]');
		await expect(title).toHaveText(monthLabel(now));
		await page.getByRole('button', { name: 'Nächster Monat', exact: true }).click();
		await expect(title).toHaveText(monthLabel(next));
	});

	test('statement title is a live region that follows the previous button', async ({ page }) => {
		await setupMember(page);
		await page.route(`**${API}/expenses*`, (route) =>
			route.fulfill({ json: { expenses: [], payments: [] } }),
		);
		await navigateToFeature(page, `${PAGE}/statement?month=2026-09`);

		const title = page.locator('h1[aria-live="polite"][aria-atomic="true"]');
		await expect(title).toHaveText('September 2026');
		await page.getByRole('button', { name: 'Vorheriger Monat', exact: true }).click();
		await expect(title).toHaveText('August 2026');
	});
});
