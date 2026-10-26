// Subscription summary, error notice and paused fixed costs in expenses.
// Why: Fixed costs must read correctly on a phone and never hide errors.

import { expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	inMinimalMatrix,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('subscription summary responsive', () => {
	skipUnlessFixtures();
	test.use({ hasTouch: true, isMobile: true });

	const abo = {
		id: 'abo-mobile-summary',
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
						route.fulfill({ json: { recurringExpenses: [abo] } }),
					);
					await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/abos`);
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

	test('a failed abo action does not leak its error into a freshly opened create form', async ({
		page,
	}) => {
		const abo = {
			id: 'abo-netflix',
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
				return route.fulfill({ json: { recurringExpenses: [abo] } });
			}
			return route.continue();
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses/*`, (route) => {
			if (route.request().method() === 'DELETE') {
				return route.fulfill({ status: 500, json: { error: 'delete_failed' } });
			}
			return route.continue();
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/abos`);
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
						template('abo-aktiv', 'Strom', null),
						template('abo-pause', 'Netflix', new Date().toISOString()),
					],
				},
			}),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
		await dismissOnboarding(page);

		await expect(
			page.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Strom' }),
		).toBeVisible();
		await expect(page.getByText('pausiert', { exact: false }).first()).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Netflix' }),
		).toHaveCount(0);
	});
});
