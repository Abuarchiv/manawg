// Subscription summary, error notice and paused fixed costs in expenses.
// Why: Fixed costs must read correctly on a phone and never hide errors.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	inMinimalMatrix,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('subscription summary responsive', () => {
	skipUnlessFixtures();
	test.use({ hasTouch: true, isMobile: true });

	const recurringExpense = {
		id: 'recurring-mobile-summary',
		description: 'Musik-Abo',
		amountCents: 123456,
		currency: 'EUR',
		paidByMemberId: FIXTURE_WG.memberId,
		intervalMonths: 1,
		nextDueAt: '2026-10-01T12:00:00.000Z',
		lastCreatedAt: null,
		pausedAt: null,
		splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 123456 }],
	};

	for (const width of [320, 360]) {
		for (const colorScheme of ['light', 'dark'] as const) {
			for (const textScale of ['normal', '200%'] as const) {
				if (
					!inMinimalMatrix({ width, dark: colorScheme === 'dark', large: textScale !== 'normal' })
				)
					continue;
				test(`monthly summary fits ${width}px ${colorScheme} ${textScale}`, async ({ page }) => {
					await page.setViewportSize({ width, height: 740 });
					await page.emulateMedia({ colorScheme });
					await setupMember(page);
					await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members*`, (route) =>
						route.fulfill({
							json: {
								members: [
									{
										id: FIXTURE_WG.memberId,
										name: FIXTURE_WG.memberName,
										color: null,
										active: true,
									},
								],
							},
						}),
					);
					await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses*`, (route) =>
						route.fulfill({ json: { recurringExpenses: [recurringExpense] } }),
					);
					await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/recurring`);
					await expect(page.getByText('Pro Monat')).toBeVisible();

					if (textScale === '200%') {
						await page.evaluate(() => {
							document.documentElement.style.fontSize = '200%';
						});
					}

					const summary = page.getByText('Pro Monat').locator('xpath=../../..');
					const metrics = await summary
						.locator('[data-slot="card-content"]')
						.evaluate((element) => ({
							rootFontSize: getComputedStyle(document.documentElement).fontSize,
							columns: getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
							contentWidth: element.clientWidth,
							scrollWidth: element.scrollWidth,
						}));

					if (textScale === '200%') {
						expect(metrics.rootFontSize).toBe('32px');
						expect(metrics.columns).toBe(1);
					} else {
						expect(metrics.columns).toBe(2);
					}
					expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.contentWidth + 1);
					await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
					if (width === 320 && colorScheme === 'dark' && textScale === '200%') {
						await page.screenshot({ path: test.info().outputPath('summary-320-dark-200.png') });
					}
				});
			}
		}
	}
});

test.describe('subscription error notice', () => {
	skipUnlessFixtures();
	test.use({ hasTouch: true, isMobile: true });

	const MINA_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

	test('a failed recurringExpense action does not leak its error into a freshly opened create form', async ({
		page,
	}) => {
		const recurringExpense = {
			id: 'recurring-netflix',
			description: 'Netflix',
			amountCents: 1499,
			currency: 'EUR',
			paidByMemberId: FIXTURE_WG.memberId,
			intervalMonths: 1,
			nextDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
			lastCreatedAt: null,
			pausedAt: null,
			splits: [
				{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 750 },
				{ debtorMemberId: MINA_ID, amountCents: 749 },
			],
		};

		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses`, (route) => {
			if (route.request().method() === 'GET') {
				return route.fulfill({ json: { recurringExpenses: [recurringExpense] } });
			}
			return route.continue();
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses/*`, (route) => {
			if (route.request().method() === 'DELETE') {
				return route.fulfill({ status: 500, json: { error: 'delete_failed' } });
			}
			return route.continue();
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/recurring`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: /^Details öffnen: Netflix/ }).click();
		await page.getByRole('button', { name: 'Netflix löschen' }).click();
		await page.getByRole('button', { name: 'Löschen' }).last().click();
		// Scoped to #main: the identical error is also announced via the transient toast region,
		// which would make an unscoped getByText match ambiguous.
		await expect(
			page.locator('#main').getByText('Fixkosten konnten nicht gelöscht werden', { exact: false }),
		).toBeVisible();

		await page.getByRole('button', { name: 'Fixkosten hinzufügen' }).click();
		const dialog = page.getByRole('dialog', { name: 'Neue Fixkosten' });
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByText('Fixkosten konnten nicht gelöscht werden', { exact: false }),
		).toHaveCount(0);
	});

	test('a rejected create submit focuses the first invalid field and keeps its message in view', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 568 });
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/recurring`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Fixkosten hinzufügen' }).click();
		const dialog = page.getByRole('dialog', { name: 'Neue Fixkosten' });
		await dialog.locator('#recurring-description').fill('Strom');
		await dialog.getByRole('button', { name: 'Fixkosten anlegen' }).click();

		await expect(dialog.locator('#recurring-amount')).toBeFocused();
		await expect(dialog.locator('#recurring-amount-error')).toBeInViewport();
	});
});

test.describe('paused fixed cost in expenses', () => {
	skipUnlessFixtures();
	test.use({ hasTouch: true, isMobile: true });

	test('a paused overdue template offers no direct booking', async ({ page }) => {
		const template = (id: string, description: string, pausedAt: string | null) => ({
			id,
			description,
			amountCents: 1499,
			currency: 'EUR',
			paidByMemberId: FIXTURE_WG.memberId,
			intervalMonths: 1,
			nextDueAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
			lastCreatedAt: null,
			pausedAt,
			splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1499 }],
		});

		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses`, (route) =>
			route.fulfill({
				json: {
					recurringExpenses: [
						template('recurring-aktiv', 'Strom', null),
						template('recurring-pause', 'Netflix', new Date().toISOString()),
					],
				},
			}),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/expenses?filter=recurring`);
		await dismissOnboarding(page);

		await expect(page.getByRole('button', { name: 'Erfassen: Strom' })).toBeVisible();
		await expect(page.getByText('pausiert', { exact: false }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Erfassen: Netflix' })).toHaveCount(0);
	});
});

test.describe('fixed-cost badge after booking', () => {
	skipUnlessFixtures();

	test('the sub-nav due count drops without a focus change once a fixed cost is booked', async ({
		page,
	}) => {
		const { shareCode } = FIXTURE_WG;
		const template = (nextDueAt: string) => ({
			id: 'recurring-strom',
			description: 'Strom',
			amountCents: 4500,
			currency: 'EUR',
			paidByMemberId: FIXTURE_WG.memberId,
			intervalMonths: 1,
			nextDueAt,
			lastCreatedAt: null,
			pausedAt: null,
			updatedAt: new Date().toISOString(),
			splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 4500 }],
		});
		const overdue = template(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());
		const advanced = template(new Date(Date.now() + 27 * 24 * 60 * 60 * 1000).toISOString());
		let booked = false;

		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
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
					activity: [],
					latestAnnouncement: null,
					myOpenAnnouncements: [],
					dueRecurringExpenses: booked
						? []
						: [
								{
									id: overdue.id,
									description: overdue.description,
									amountCents: overdue.amountCents,
									currency: 'EUR',
									nextDueAt: overdue.nextDueAt,
								},
							],
					absentMembers: [],
					setup: {
						choreCount: 0,
						hasExpense: true,
						hasShoppingItem: true,
						hasAnnouncement: true,
						notificationsEnabled: false,
					},
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [booked ? advanced : overdue] } }),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) => {
			if (route.request().method() !== 'POST') return route.fallback();
			booked = true;
			return route.fulfill({
				status: 201,
				json: {
					expense: {
						id: 'expense-strom',
						description: 'Strom',
						amountCents: 4500,
						currency: 'EUR',
						paidByMemberId: FIXTURE_WG.memberId,
						createdAt: new Date().toISOString(),
						splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 4500 }],
					},
					recurringExpense: advanced,
				},
			});
		});

		await navigateToFeature(page, `/wg/${shareCode}/expenses?filter=recurring`);
		await dismissOnboarding(page);
		await expect(page.getByRole('link', { name: 'Fixkosten, 1 fällig' })).toBeVisible();

		await page.getByRole('button', { name: 'Erfassen: Strom' }).click();

		await expect(page.getByRole('link', { name: 'Fixkosten, 0 fällig' })).toBeVisible({
			timeout: 5000,
		});
		await expect(page.getByRole('link', { name: 'Fixkosten, 1 fällig' })).toHaveCount(0);
	});
});
