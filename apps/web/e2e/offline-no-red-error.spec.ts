// Offline with data on screen: Expenses, fixed costs, pinboard, activity and debts keep their rows
// and show no load error; only the offline bar speaks. Without data, or on a server error, the error stays.
// Why: a banner above data that loaded fine reads as lost data on the most used screens.

import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

const base = `/wg/${FIXTURE_WG.shareCode}`;
const memberIds = { me: FIXTURE_WG.memberId, other: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55' };
const now = new Date().toISOString();

const expense = {
	id: '00000000-0000-4000-8000-0000000000a1',
	wgId: '989ac820-58b7-431f-9c65-28721264f333',
	paidByMemberId: memberIds.me,
	amountCents: 4200,
	currency: 'EUR',
	description: 'Offline row',
	category: 'groceries',
	imageUrl: null,
	occurredAt: now,
	createdAt: now,
	updatedAt: now,
	splits: [
		{ id: 's1', expenseId: 'a1', debtorMemberId: memberIds.me, amountCents: 2100, settledAt: now },
		{
			id: 's2',
			expenseId: 'a1',
			debtorMemberId: memberIds.other,
			amountCents: 2100,
			settledAt: null,
		},
	],
};
const template = {
	id: '00000000-0000-4000-8000-0000000000b1',
	wgId: '989ac820-58b7-431f-9c65-28721264f333',
	createdByMemberId: memberIds.me,
	paidByMemberId: memberIds.me,
	description: 'Offline row',
	category: 'housing',
	amountCents: 3290,
	currency: 'EUR',
	intervalMonths: 1,
	nextDueAt: now,
	lastCreatedAt: null,
	pausedAt: null,
	createdAt: now,
	splits: [{ debtorMemberId: memberIds.me, amountCents: 3290 }],
};
const post = {
	id: 'offline-post',
	authorMemberId: memberIds.me,
	content: 'Offline row',
	imageUrl: null,
	kind: 'question',
	status: 'open',
	source: 'manual',
	sourcePath: null,
	pinnedAt: null,
	resolvedAt: null,
	resolvedByMemberId: null,
	createdAt: now,
	reactionCounts: {},
	myReactions: [],
	takers: [],
	comments: [],
};
const activityItem = {
	id: 'offline-act',
	kind: 'shopping',
	timestamp: now,
	memberId: memberIds.me,
	memberName: FIXTURE_WG.memberName,
	text: 'Offline row',
	completed: true,
};

// Each page: the API paths it reads (with the body served while online) and a row it shows.
const PAGES = [
	{
		name: 'expenses',
		path: 'expenses',
		apis: { '/expenses': { expenses: [expense], payments: [] } },
		row: 'Offline row',
	},
	{
		name: 'fixed costs',
		path: 'recurring',
		apis: { '/recurring-expenses': { recurringExpenses: [template] } },
		row: 'Offline row',
	},
	{
		name: 'pinboard',
		path: 'pinboard',
		apis: { '/announcements': { announcements: [post] } },
		row: 'Offline row',
	},
	{
		name: 'activity',
		path: 'activity',
		apis: { '/activity': { items: [activityItem], reminders: [] } },
		row: 'Offline row',
	},
	{
		name: 'debts',
		path: 'reminders',
		apis: { '/expenses': { expenses: [expense], payments: [] }, '/reminders': { reminders: [] } },
		row: '21,00',
	},
] as const;

/** The destructive alert of the load-error banner; Next's empty route announcer also has role alert. */
const loadError = (page: Page) => page.locator('[data-slot="alert"][role="alert"]');

type Mode = 'ok' | 'offline' | 'server-error';

/** Serves each page API from `apis` while the mode is ok; otherwise it fails them like a dead network or a 500. */
async function serve(page: Page, apis: Record<string, unknown>, mode: () => Mode): Promise<void> {
	for (const [api, json] of Object.entries(apis)) {
		await page.route(
			(url) => url.pathname === `/api${base}${api}`,
			(route) => {
				if (route.request().method() !== 'GET') return route.continue();
				if (mode() === 'offline') return route.abort('internetdisconnected');
				if (mode() === 'server-error') return route.fulfill({ status: 500, json: { error: 'x' } });
				return route.fulfill({ json });
			},
		);
	}
}

test.describe('offline without a red load error', () => {
	skipUnlessFixtures();
	test.use({ hasTouch: true, isMobile: true });

	for (const { name, path, apis, row } of PAGES) {
		const first = Object.keys(apis)[0];
		const rowText = (page: Page) => page.getByText(row).first();

		test(`${name} keeps its data and shows only the offline bar`, async ({ context, page }) => {
			let mode: Mode = 'ok';
			await setupMember(page);
			await serve(page, apis, () => mode);
			await navigateToFeature(page, `${base}/${path}`);
			await page.waitForLoadState('networkidle');
			await expect(rowText(page)).toBeVisible();
			await expect(loadError(page)).toHaveCount(0);

			// A refresh that fails: the focus event starts one, the dead network kills it.
			mode = 'offline';
			await context.setOffline(true);
			const failed = page.waitForEvent(
				'requestfailed',
				(req) => new URL(req.url()).pathname === `/api${base}${first}`,
			);
			await page.evaluate(() => {
				window.dispatchEvent(new Event('offline'));
				window.dispatchEvent(new Event('focus'));
			});
			await failed;
			await expect(page.locator('[data-offline-banner]')).toBeVisible();
			await page.waitForTimeout(300);
			await expect(loadError(page)).toHaveCount(0);
			await expect(rowText(page)).toBeVisible();
		});

		test(`${name} still shows a server error over its data`, async ({ page }) => {
			let mode: Mode = 'ok';
			await setupMember(page);
			await serve(page, apis, () => mode);
			await navigateToFeature(page, `${base}/${path}`);
			await page.waitForLoadState('networkidle');
			await expect(rowText(page)).toBeVisible();

			mode = 'server-error';
			// A focus that lands while another read is in flight is folded into it, so ask again.
			await expect(async () => {
				await page.evaluate(() => window.dispatchEvent(new Event('focus')));
				await expect(loadError(page).first()).toBeVisible({ timeout: 1500 });
			}).toPass({ timeout: 15_000 });
		});

		test(`${name} on a cold load that cannot reach the server shows the error`, async ({
			page,
		}) => {
			await setupMember(page);
			await serve(page, apis, () => 'offline');
			await navigateToFeature(page, `${base}/${path}`);
			await expect(loadError(page).first()).toBeVisible();
		});
	}
});
