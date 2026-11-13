// Start page "New since last visit": others' entries since a browser-local marker.
// Why: the marker must hide nothing on a quick reload, never list the reader's own entries, and
// only move on to the server time of a payload that was actually shown.

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
	const MARKER_NOW = new Date(NOW).toISOString();
	const newButton = (page: import('@playwright/test').Page) =>
		page.getByRole('button', { name: 'Neu seit deinem letzten Besuch · 1' });

	function dashboard() {
		return {
			generatedAt: new Date(NOW).toISOString(),
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

	test('without a marker the heading stays neutral and the marker is written', async ({ page }) => {
		await open(page, null);
		await expect(page.getByRole('link', { name: 'Neu in deiner WG' })).toBeVisible();
		await expect(page.getByText('Nichts Neues seit deinem letzten Besuch')).toHaveCount(0);
		await expect(page.getByText('Kinoabend')).toHaveCount(0);
		expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(MARKER_NOW);
	});

	test('nothing newer than the marker is one quiet link, not a fold-out', async ({ page }) => {
		await open(page, MARKER_NOW);
		const line = page.getByRole('link', { name: 'Nichts Neues seit deinem letzten Besuch' });
		await expect(line).toHaveAttribute('href', `/wg/${FIXTURE_WG.shareCode}/activity`);
		await expect(page.getByRole('button', { name: /Nichts Neues/ })).toHaveCount(0);
	});

	test('a quick reload keeps the list, six visible seconds clear it', async ({ page }) => {
		await open(page, minutesAgo(60));
		await expect(newButton(page)).toBeVisible();

		await page.clock.runFor(2_000);
		await page.reload();
		await dismissOnboarding(page);
		await expect(newButton(page)).toBeVisible();
		expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(minutesAgo(60));

		// The list of the running visit stays even though the marker moves on, to the payload's
		// server time and not to the phone's clock.
		await page.clock.runFor(6_000);
		await expect(newButton(page)).toBeVisible();
		expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(MARKER_NOW);

		await page.reload();
		await dismissOnboarding(page);
		await expect(
			page.getByRole('link', { name: 'Nichts Neues seit deinem letzten Besuch' }),
		).toBeVisible();
	});

	test('leaving in the app after six visible seconds keeps the marker moved', async ({ page }) => {
		await open(page, minutesAgo(60));
		await expect(newButton(page)).toBeVisible();
		await page.clock.runFor(6_000);
		await page.getByRole('link', { name: /Gesamte Aktivität/ }).click();
		await page.waitForURL(/\/activity$/);
		expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(MARKER_NOW);
		await page.goBack();
		await dismissOnboarding(page);
		await expect(
			page.getByRole('link', { name: 'Nichts Neues seit deinem letzten Besuch' }),
		).toBeVisible();
	});

	test('time spent hidden does not count as seen', async ({ page }) => {
		await open(page, minutesAgo(60));
		await expect(newButton(page)).toBeVisible();
		const setVisibility = (state: 'hidden' | 'visible') =>
			page.evaluate((value) => {
				Object.defineProperty(document, 'visibilityState', { value, configurable: true });
				document.dispatchEvent(new Event('visibilitychange'));
			}, state);
		const stored = () => page.evaluate((key) => localStorage.getItem(key), KEY);

		await page.clock.runFor(2_000);
		await setVisibility('hidden');
		await page.clock.runFor(8_000);
		expect(await stored()).toBe(minutesAgo(60));

		await setVisibility('visible');
		await page.clock.runFor(2_000);
		expect(await stored()).toBe(minutesAgo(60));
		await page.clock.runFor(1_500);
		expect(await stored()).toBe(MARKER_NOW);
	});
});
