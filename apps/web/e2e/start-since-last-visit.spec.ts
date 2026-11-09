// Start page "New since last visit": others' entries since a browser-local marker.
// Why: the marker must hide nothing on a quick reload and never list the reader's own entries.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockDashboard,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('start page since last visit', () => {
	skipUnlessFixtures();

	const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
	const KEY = `manawg:start-last-seen:${FIXTURE_WG.id}:${FIXTURE_WG.memberId}`;
	const NOW = Date.parse('2026-11-09T12:00:00.000Z');
	const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

	function dashboard() {
		return {
			balances: [],
			spendByDay: [],
			totalSpendByCurrency: {},
			weekSpendByCurrency: {},
			monthSpendByCurrency: {},
			openShoppingCount: 0,
			openShoppingTop: [],
			dueChores: [],
			activity: [
				{
					kind: 'expense',
					timestamp: minutesAgo(10),
					memberId: 'mina',
					memberName: 'Mina',
					text: 'Kinoabend',
					amountCents: 3600,
					currency: 'EUR',
				},
				{
					kind: 'expense',
					timestamp: minutesAgo(5),
					memberId: FIXTURE_WG.memberId,
					memberName: FIXTURE_WG.memberName,
					text: 'Eigener Einkauf',
					amountCents: 900,
					currency: 'EUR',
				},
				{
					kind: 'expense',
					timestamp: minutesAgo(120),
					memberId: 'mina',
					memberName: 'Mina',
					text: 'Altes Zeug',
					amountCents: 500,
					currency: 'EUR',
				},
			],
			latestAnnouncement: null,
			myOpenAnnouncements: [],
			dueRecurringExpenses: [],
			absentMembers: [],
			setup: {
				choreCount: 1,
				hasExpense: true,
				hasShoppingItem: true,
				hasAnnouncement: true,
				notificationsEnabled: false,
			},
		};
	}

	async function open(page: import('@playwright/test').Page, seed: string | null) {
		await page.clock.install({ time: new Date(NOW) });
		await setupMember(page);
		await page.addInitScript(
			([key, value]) => {
				if (value && !localStorage.getItem(key as string))
					localStorage.setItem(key as string, value);
			},
			[KEY, seed],
		);
		await mockDashboard(page, BASE, dashboard());
		await mockUnreadCount(page, BASE);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);
	}

	test('lists only others’ entries since the marker, opened', async ({ page }) => {
		await open(page, minutesAgo(60));
		const trigger = page.getByRole('button', { name: 'Neu seit deinem letzten Besuch · 1' });
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		const list = page.locator('section[aria-labelledby="wg-now-heading"]');
		await expect(list.getByText('Mina ·')).toBeVisible();
		await expect(list.getByText('Kinoabend')).toBeVisible();
		await expect(list.getByText('Eigener Einkauf')).toHaveCount(0);
		await expect(list.getByText('Altes Zeug')).toHaveCount(0);
		await expect(list.getByRole('link', { name: /Gesamte Aktivität/ })).toBeVisible();
	});

	test('first visit shows nothing new and writes the marker', async ({ page }) => {
		await open(page, null);
		const trigger = page.getByRole('button', { name: 'Nichts Neues seit deinem letzten Besuch' });
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).not.toBeNull();
	});

	test('a quick reload keeps the list, six visible seconds clear it', async ({ page }) => {
		await open(page, minutesAgo(60));
		await expect(
			page.getByRole('button', { name: 'Neu seit deinem letzten Besuch · 1' }),
		).toBeVisible();

		await page.clock.runFor(2_000);
		await page.reload();
		await dismissOnboarding(page);
		await expect(
			page.getByRole('button', { name: 'Neu seit deinem letzten Besuch · 1' }),
		).toBeVisible();
		expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(minutesAgo(60));

		// The list of the running visit stays even though the marker moves on.
		await page.clock.runFor(6_000);
		await expect(
			page.getByRole('button', { name: 'Neu seit deinem letzten Besuch · 1' }),
		).toBeVisible();
		expect(
			Date.parse((await page.evaluate((key) => localStorage.getItem(key), KEY)) ?? ''),
		).toBeGreaterThanOrEqual(NOW);

		await page.reload();
		await dismissOnboarding(page);
		await expect(
			page.getByRole('button', { name: 'Nichts Neues seit deinem letzten Besuch' }),
		).toBeVisible();
	});
});
