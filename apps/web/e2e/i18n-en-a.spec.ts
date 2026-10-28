// English app shell: start page, activity page, navigation and error pages.
// Why: Every shell string ships in two languages; a missed one would show German chrome in English.

import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockDashboard,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
const WG_HREF = `/wg/${FIXTURE_WG.shareCode}`;
const WIDTHS = [320, 390] as const;
const SCHEMES = ['light', 'dark'] as const;

function dashboard() {
	const now = Date.now();
	return {
		balances: [
			{
				memberId: FIXTURE_WG.memberId,
				memberName: FIXTURE_WG.memberName,
				color: null,
				paidCents: 0,
				owedCents: 1250,
				balanceCents: -1250,
				currency: 'EUR',
			},
			{
				memberId: 'anna',
				memberName: 'Anna',
				color: null,
				paidCents: 1250,
				owedCents: 0,
				balanceCents: 1250,
				currency: 'EUR',
			},
		],
		spendByDay: [],
		totalSpendByCurrency: {},
		weekSpendByCurrency: {},
		monthSpendByCurrency: {},
		totalSpendCents: null,
		weekSpendCents: null,
		monthSpendCents: null,
		openShoppingCount: 3,
		openShoppingTop: ['Milch'],
		dueChores: [
			{
				id: 'mine',
				title: 'Bad putzen',
				nextDueAt: new Date(now).toISOString(),
				overdue: false,
				assignedMemberId: FIXTURE_WG.memberId,
				assignedMemberName: FIXTURE_WG.memberName,
				assignedColor: null,
			},
			{
				id: 'unassigned',
				title: 'Müll rausbringen',
				nextDueAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
				overdue: true,
				assignedMemberId: null,
				assignedMemberName: null,
				assignedColor: null,
			},
		],
		activity: [],
		latestAnnouncement: null,
		myOpenAnnouncements: [
			{
				id: 'request-1',
				kind: 'request',
				content: 'Paket abholen',
				createdAt: new Date(now).toISOString(),
			},
		],
		dueRecurringExpenses: [
			{
				id: 'internet',
				description: 'Internet',
				amountCents: 2990,
				currency: 'EUR',
				nextDueAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
			},
		],
		absentMembers: [],
		setup: {
			choreCount: 2,
			hasExpense: true,
			hasShoppingItem: true,
			hasAnnouncement: true,
			notificationsEnabled: false,
		},
	};
}

async function prepare(
	page: Page,
	context: BrowserContext,
	baseURL: string | undefined,
	width: number,
	colorScheme: 'light' | 'dark',
): Promise<void> {
	await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
	await setupMember(page);
	await mockUnreadCount(page, BASE, 3);
	await mockDashboard(page, BASE, dashboard());
	await page.route(`**${BASE}/events*`, (route) => route.fulfill({ json: { events: [] } }));
	await page.route(`**${BASE}/activity?*`, (route) =>
		route.fulfill({
			json: {
				items: [
					{
						id: 'act-1',
						kind: 'shopping',
						timestamp: new Date().toISOString(),
						memberId: 'anna',
						memberName: 'Anna',
						text: 'Brot',
						completed: true,
					},
				],
				reminders: [
					{
						kind: 'shopping',
						title: { key: 'activity.reminder.shoppingOpen', values: { name: 'Brot', days: 4 } },
						detail: { key: 'activity.reminder.shoppingDetail' },
						href: '/einkauf',
					},
				],
			},
		}),
	);
	await page.setViewportSize({ width, height: 780 });
	await page.emulateMedia({ colorScheme });
}

async function expectNoSidewaysScroll(page: Page, width: number): Promise<void> {
	if (width === 320) return expectNoHorizontalOverflow(page);
	const widths = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth,
	}));
	expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test.describe('English app shell', () => {
	skipUnlessFixtures();

	for (const width of WIDTHS) {
		for (const scheme of SCHEMES) {
			const where = `${width}px ${scheme}`;

			test(`start page and navigation at ${where}`, async ({ page, context, baseURL }) => {
				await prepare(page, context, baseURL, width, scheme);
				await navigateToFeature(page, WG_HREF);
				await dismissOnboarding(page);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page.getByRole('heading', { name: 'For you', level: 2 })).toBeVisible();
				await expect(page.getByRole('heading', { name: 'This week', level: 2 })).toBeVisible();
				await expect(page.getByRole('button', { name: 'New in your flat' })).toBeVisible();
				await expect(page.getByText('due today', { exact: false }).first()).toBeVisible();
				await expect(page.getByText('To Anna', { exact: true })).toBeVisible();
				await expect(page.getByText('€12.50').first()).toBeVisible();
				await expect(page.getByText('Takeover open', { exact: true })).toBeVisible();

				const nav = page.getByRole('navigation', { name: 'Flat main navigation' });
				for (const label of ['Home', 'Household', 'Money', 'Together']) {
					await expect(nav.getByRole('link', { name: label })).toBeVisible();
				}
				await expect(
					page.getByRole('link', { name: 'Open chat, 3 unread', exact: true }),
				).toBeVisible();
				await expect(
					page.getByRole('link', { name: 'Open account and flat settings' }),
				).toBeVisible();

				await expectNoGermanChrome(page);
				await expectNoSidewaysScroll(page, width);
			});

			test(`activity page at ${where}`, async ({ page, context, baseURL }) => {
				await prepare(page, context, baseURL, width, scheme);
				await navigateToFeature(page, `${WG_HREF}/aktivitaet`);
				await dismissOnboarding(page);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
				await expect(page.getByPlaceholder('Search')).toBeVisible();
				await expect(page.getByLabel('Area')).toBeVisible();
				await expect(page.getByText('Brot has been on the list for 4 days')).toBeVisible();
				await expect(page.getByText('Today', { exact: true })).toBeVisible();

				await expectNoGermanChrome(page);
				await expectNoSidewaysScroll(page, width);
			});
		}
	}

	test('error and not-found pages are English', async ({ page, context, baseURL }) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');

		await navigateToFeature(page, '/diese-seite-gibt-es-nicht');
		await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
		await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Go to home page' })).toBeVisible();
		await expectNoGermanChrome(page);

		await navigateToFeature(page, '/wg/ZZZZZZZZ');
		await expect(page.getByRole('heading', { name: 'Flat not found', level: 1 })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Create or join a new flat' })).toBeVisible();
		await expectNoGermanChrome(page);
		await expectNoHorizontalOverflow(page);
	});

	test('the route error boundary is English', async ({ page, context, baseURL }) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await setupMember(page);
		await mockUnreadCount(page, BASE);
		// A reply the page cannot parse makes the dashboard read throw while rendering.
		await page.route(`**${BASE}/activity?*`, (route) =>
			route.fulfill({ json: { items: 'broken', reminders: 'broken' } }),
		);
		await navigateToFeature(page, `${WG_HREF}/aktivitaet`);
		const heading = page.getByRole('heading', { name: 'Activity could not be loaded just now' });
		await expect(heading).toBeVisible();
		await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Report error by email' })).toBeVisible();
		await expectNoGermanChrome(page);
	});
});
