// English sweep: every page route and the primary dialogs of the WG sections.
// Why: package reports pass each screen alone; this run catches German chrome that only shows when
// a consumer and its helper belong to different packages. It also pins that German stays German.

import { expect, type Page, test } from '@playwright/test';
import { E2E_INVITE_TOKEN } from '../src/fixtures/data';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	seedLocalAccount,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const WG = `/wg/${FIXTURE_WG.shareCode}`;
const SCHEMES = ['light', 'dark'] as const;
const MODULES = [
	'ausgaben',
	'einkauf',
	'pinnwand',
	'putzen',
	'fixkosten',
	'mahnungen',
	'vorraete',
	'kalender',
	'aktivitaet',
	'chat',
];

/** Pages without a signed-in member. */
const ENTRY_ROUTES = [
	'/',
	'/neu',
	'/registrieren',
	'/auth/reset',
	`/einladung/${E2E_INVITE_TOKEN}`,
	...MODULES.map((slug) => `/entdecken/${slug}`),
];

/** WG sections; `dialog` is the primary button that opens a form on that page. */
const WG_ROUTES: { path: string; dialog?: string }[] = [
	{ path: '' },
	{ path: '/ausgaben', dialog: 'Add expense' },
	{ path: '/abos' },
	{ path: '/abrechnung' },
	{ path: '/mahnungen' },
	{ path: '/import' },
	{ path: '/putzen', dialog: 'Add cleaning task' },
	{ path: '/kalender', dialog: 'Add event' },
	{ path: '/einkauf' },
	{ path: '/vorraete', dialog: 'Add item' },
	{ path: '/pinnwand', dialog: 'Add post' },
	{ path: '/chat' },
	{ path: '/aktivitaet' },
	{ path: '/einstellungen#profil' },
	{ path: '/einstellungen#benachrichtigungen' },
	{ path: '/einstellungen#zugang' },
	{ path: '/einstellungen#daten' },
];

async function guestSession(page: Page): Promise<void> {
	await setupMember(page);
	await page.route('**/api/wg/mine', (route) =>
		route.fulfill({ status: 401, json: { error: 'auth_required', code: 'auth_required' } }),
	);
	await page.route(`**/api/wg/invites/${E2E_INVITE_TOKEN}`, (route) =>
		route.fulfill({ status: 401, json: { error: 'auth_required', code: 'auth_required' } }),
	);
}

async function settle(page: Page): Promise<void> {
	await expect(page.locator('h1').first()).toBeAttached({ timeout: 60_000 });
	await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

async function expectEnglishPage(page: Page): Promise<void> {
	await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
	await expectNoGermanChrome(page);
	await expectNoHorizontalOverflow(page);
}

test.describe('English sweep', () => {
	skipUnlessFixtures();

	for (const colorScheme of SCHEMES) {
		test.describe(`entry pages (${colorScheme})`, () => {
			for (const route of ENTRY_ROUTES) {
				test(`${route} reads English at 320px`, async ({ context, page, baseURL }) => {
					await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
					await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
					await page.setViewportSize({ width: 320, height: 780 });
					await guestSession(page);
					await page.goto(route, { timeout: 120_000 });
					await settle(page);
					await expectEnglishPage(page);
				});
			}

			test('/offline reads English at 320px', async ({ context, page, baseURL }) => {
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width: 320, height: 780 });
				await seedLocalAccount(page);
				await setupMember(page);
				await page.goto('/offline', { timeout: 120_000 });
				await settle(page);
				await expectEnglishPage(page);
			});
		});

		test.describe(`WG sections (${colorScheme})`, () => {
			for (const { path, dialog } of WG_ROUTES) {
				test(`${path || '/'} reads English at 320px`, async ({ context, page, baseURL }) => {
					test.setTimeout(120_000);
					await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
					await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
					await page.setViewportSize({ width: 320, height: 780 });
					await setupMember(page);
					await navigateToFeature(page, `${WG}${path}`);
					await dismissOnboarding(page);
					await settle(page);
					await expectEnglishPage(page);

					if (path === '/einkauf') {
						// The shopping list adds inline: a typed item enables the button, and the unmocked write fails.
						await page.getByPlaceholder('e.g. 2 avocados').fill('2 oat milk');
						await page.getByRole('button', { name: 'Add item', exact: true }).click();
						await page.waitForTimeout(1_000);
						await expectEnglishPage(page);
						return;
					}
					if (!dialog) return;
					await page.getByRole('button', { name: dialog, exact: true }).first().click();
					await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 15_000 });
					await expectEnglishPage(page);
				});
			}
		});
	}

	test.describe('German stays German', () => {
		const GERMAN_ROUTES: [string, RegExp][] = [
			['/neu', /Anmelden|Konto/],
			['/ausgaben', /Ausgaben/],
			['/einkauf', /Einkäufe/],
			['/kalender', /Kalender/],
			['/einstellungen#profil', /Einstellungen/],
		];

		for (const [path, heading] of GERMAN_ROUTES) {
			test(`${path} stays German`, async ({ page }) => {
				test.setTimeout(120_000);
				await page.setViewportSize({ width: 320, height: 780 });
				await setupMember(page);
				if (path === '/neu') await page.goto(path, { timeout: 120_000 });
				else {
					await navigateToFeature(page, `${WG}${path}`);
					await dismissOnboarding(page);
				}
				await settle(page);
				await expect(page.locator('html')).toHaveAttribute('lang', 'de');
				await expect(page.locator('a.skip-link')).toHaveText('Zum Hauptinhalt springen');
				await expect(page.locator('h1').first()).toHaveText(heading);
			});
		}
	});

	test.describe('label in name (English)', () => {
		const { memberId, memberName, shareCode } = FIXTURE_WG;
		const BASE = `/api/wg/${shareCode}`;
		const OTHER_MEMBER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

		test.beforeEach(async ({ context, page, baseURL }) => {
			await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
			await setupMember(page);
			await mockUnreadCount(page, BASE);
		});

		test('new-WG invite card names the visible action', async ({ page }) => {
			await page.route(`**${BASE}/dashboard`, (route) =>
				route.fulfill({
					json: {
						balances: [],
						spendByDay: [],
						totalSpendByCurrency: {},
						weekSpendByCurrency: {},
						monthSpendByCurrency: {},
						openShoppingCount: 0,
						openShoppingTop: [],
						dueChores: [],
						dueRecurringExpenses: [],
						activity: [],
						latestAnnouncement: null,
						myOpenAnnouncements: [],
						absentMembers: [],
						setup: {
							choreCount: 0,
							hasExpense: false,
							hasShoppingItem: false,
							hasAnnouncement: false,
							notificationsEnabled: false,
						},
					},
				}),
			);
			await navigateToFeature(page, WG);
			await dismissOnboarding(page);
			await expect(
				page.getByRole('button', { name: 'Invite flatmates', exact: true }),
			).toBeVisible();
		});

		test('subscription pause button leads with the visible action', async ({ page }) => {
			await page.route(`**${BASE}/members*`, (route) =>
				route.fulfill({
					json: { members: [{ id: memberId, name: memberName, color: null, active: true }] },
				}),
			);
			await page.route(`**${BASE}/recurring-expenses*`, (route) =>
				route.fulfill({
					json: {
						recurringExpenses: [
							{
								id: 'abo-label-audit',
								description: 'Music plan',
								amountCents: 999,
								currency: 'EUR',
								paidByMemberId: memberId,
								intervalMonths: 1,
								nextDueAt: '2026-10-01T12:00:00.000Z',
								lastCreatedAt: null,
								pausedAt: null,
								splits: [{ debtorMemberId: memberId, amountCents: 999 }],
							},
						],
					},
				}),
			);
			await navigateToFeature(page, `${WG}/abos`);
			await page.getByRole('button', { name: /Open details: Music plan/ }).click();
			await expect(
				page.getByRole('button', { name: 'Pause: Music plan', exact: true }),
			).toBeVisible();
		});

		test('expense settle button leads with the visible action', async ({ page }) => {
			await page.route(`**${BASE}/members`, (route) =>
				route.fulfill({
					json: {
						members: [
							{ id: memberId, name: memberName, color: null, active: true },
							{ id: OTHER_MEMBER_ID, name: 'Mina', color: null, active: true },
						],
						viewerIsAdmin: false,
					},
				}),
			);
			await page.route(`**${BASE}/expenses`, (route) =>
				route.fulfill({
					json: {
						expenses: [
							{
								id: 'expense-label-audit',
								paidByMemberId: memberId,
								amountCents: 2000,
								currency: 'EUR',
								description: 'Weekly shop',
								imageUrl: null,
								occurredAt: '2026-09-24T17:00:00.000Z',
								createdAt: '2026-09-24T17:00:00.000Z',
								updatedAt: '2026-09-24T17:00:00.000Z',
								splits: [
									{
										id: 'split-label-audit',
										debtorMemberId: OTHER_MEMBER_ID,
										amountCents: 1000,
										settledAt: null,
									},
								],
							},
						],
						payments: [],
					},
				}),
			);
			await page.route(`**${BASE}/recurring-expenses`, (route) =>
				route.fulfill({ json: { recurringExpenses: [] } }),
			);
			await page.route(`**${BASE}/dashboard`, (route) =>
				route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
			);
			await navigateToFeature(page, `${WG}/ausgaben`);
			await dismissOnboarding(page);
			await page.getByRole('button', { name: /Open details/ }).click();
			await expect(
				page.getByRole('button', { name: 'Mark as paid: Mina', exact: true }),
			).toBeVisible();
		});
	});
});
