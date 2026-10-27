// Expense row reflow, currency and payer edit, offline edit.
// Why: Edit paths must keep amounts and payers intact at 320px.

import { type Locator, type Page, expect, test } from '@playwright/test';
import {
	createQueuedExpenseUpdate,
	getOfflineActionRequest,
} from '../src/core/offline/offline-queue';
import type { Expense } from '../src/features/expenses/expense-types';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('expense row reflow', () => {
	skipUnlessFixtures();
	test.use({ hasTouch: true });

	const EXPENSE_ID = '9af0f27a-3d2b-4983-b5cb-3920f6d6e51f';
	const DESCRIPTION = 'Einkäufe für das Abendessen bei Freunden morgen';

	test('expense rows stay readable and actionable on narrow screens', async ({ page }) => {
		expect(DESCRIPTION).toHaveLength(47);

		const { memberId, memberName, shareCode } = FIXTURE_WG;
		await setupMember(page);
		await page.setViewportSize({ width: 320, height: 800 });
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [{ id: memberId, name: memberName, color: null, active: true }],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({
				json: {
					expenses: [
						{
							id: EXPENSE_ID,
							paidByMemberId: memberId,
							amountCents: 12345,
							currency: 'EUR',
							description: DESCRIPTION,
							imageUrl: null,
							occurredAt: '2026-09-24T17:00:00.000Z',
							createdAt: '2026-09-24T17:00:00.000Z',
							updatedAt: '2026-09-24T17:00:00.000Z',
							splits: [],
						},
					],
					payments: [],
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);

		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);

		const row = page.locator(`#expense-${EXPENSE_ID}`);
		const title = row.getByText(DESCRIPTION, { exact: true });
		const amount = row.getByRole('button').first().locator('span.font-mono');
		const action = row.getByRole('button', { name: `Aktionen für ${DESCRIPTION}` });
		await expect(title).toBeVisible();

		for (const theme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await expect
				.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
				.toBe(theme === 'dark');

			for (const width of [320, 360, 390]) {
				await page.setViewportSize({ width, height: 800 });
				for (const largeText of [false, true]) {
					await page.evaluate((enabled) => {
						document.documentElement.style.fontSize = enabled ? '200%' : '';
					}, largeText);

					const layout = await row.evaluate((element) => ({
						rowHeight: element.getBoundingClientRect().height,
						rowClientWidth: element.clientWidth,
						rowScrollWidth: element.scrollWidth,
					}));
					const documentWidth = await page.evaluate(() => ({
						client: document.documentElement.clientWidth,
						scroll: document.documentElement.scrollWidth,
					}));

					expect(
						layout.rowHeight,
						`${theme}, ${width}px, ${largeText ? '32px' : 'normal'} text`,
					).toBeLessThan(500);
					expect(layout.rowScrollWidth).toBeLessThanOrEqual(layout.rowClientWidth);
					expect(documentWidth.scroll).toBeLessThanOrEqual(documentWidth.client);
					if (width === 390 && !largeText) {
						const titleBox = await title.boundingBox();
						const amountBox = await amount.boundingBox();
						if (!titleBox || !amountBox) throw new Error('expense title or amount missing');
						expect(Math.abs(titleBox.y - amountBox.y)).toBeLessThan(2);
					}

					await expect(action).toBeVisible();
					await action.focus();
					await page.keyboard.press('Enter');
					await expect(
						page.getByRole('menuitem', { name: 'Bearbeiten', exact: true }),
					).toBeVisible();
					await page.keyboard.press('Escape');
					await action.tap();
					await expect(
						page.getByRole('menuitem', { name: 'Bearbeiten', exact: true }),
					).toBeVisible();
					// An Escape right after opening can land during the opening phase; keep measuring only
					// once the menu is really gone. Otherwise WebKit still shows it at the old, wider
					// anchor position and the next pass reports a false overflow.
					await expect(async () => {
						await page.keyboard.press('Escape');
						await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 500 });
					}).toPass();
				}
			}
		}

		// Deleting confirms with a success message, like recurring costs.
		await page.route(`**/api/wg/${shareCode}/expenses/${EXPENSE_ID}`, (route) =>
			route.fulfill({ json: { deleted: true } }),
		);
		await page.evaluate(() => {
			document.documentElement.style.fontSize = '';
		});
		await action.tap();
		await page.getByRole('menuitem', { name: 'Löschen', exact: true }).click();
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: 'Löschen', exact: true })
			.click();
		await expect(page.getByText('Ausgabe gelöscht.')).toBeVisible();
	});
});

test.describe('expense currency edit', () => {
	skipUnlessFixtures();

	const currencies = ['CHF', 'USD', 'GBP'] as const;
	const splitCurrencyLabels: Record<(typeof currencies)[number], string> = {
		CHF: 'CHF',
		USD: '$',
		GBP: '£',
	};
	const otherMemberId = '11111111-1111-4111-8111-111111111111';

	async function expectNoHorizontalOverflow(
		page: Page,
		width: number,
		elements: Locator[],
	): Promise<void> {
		await page.setViewportSize({ width, height: 640 });
		for (const element of elements) {
			const bounds = await element.evaluate((node) => ({
				clientWidth: node.clientWidth,
				scrollWidth: node.scrollWidth,
			}));
			expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
	}

	test('shows each existing expense currency while editing at 200% text size', async ({ page }) => {
		const { shareCode, memberId, memberName } = FIXTURE_WG;
		const occurredAt = '2026-09-18T10:00:00.000Z';
		const expenses = currencies.map((currency) => {
			const id = `expense-${currency.toLowerCase()}`;
			return {
				id,
				paidByMemberId: memberId,
				amountCents: 12_345,
				currency,
				description: `Ausgabe ${currency}`,
				imageUrl: null,
				occurredAt,
				createdAt: occurredAt,
				updatedAt: occurredAt,
				splits: [
					{
						id: `split-${currency.toLowerCase()}`,
						expenseId: id,
						debtorMemberId: otherMemberId,
						amountCents: 12_345,
						settledAt: null,
					},
				],
			};
		});

		await setupMember(page);
		await page.setViewportSize({ width: 320, height: 640 });
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: memberId, name: memberName, color: null, active: true },
						{ id: otherMemberId, name: 'Mina', color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({ json: { expenses, payments: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);

		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);
		await page.evaluate(() => {
			document.documentElement.style.fontSize = '200%';
		});
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
			'32px',
		);

		for (const expense of expenses) {
			await page.getByRole('button', { name: `Aktionen für ${expense.description}` }).click();
			await page.getByRole('menuitem', { name: 'Bearbeiten', exact: true }).click();
			const dialog = page.getByRole('dialog');
			await expect(dialog).toBeVisible();
			const amountGroup = dialog.getByLabel('Betrag').locator('xpath=..');
			await expect(amountGroup).toContainText(expense.currency);
			await expect(amountGroup).not.toContainText('€');
			// A single-debtor split is an equal split among participants, so open the manual fields.
			await dialog.getByRole('button', { name: 'Aufteilung: Manuell', exact: true }).click();
			const shareGroup = dialog
				.getByLabel(`Anteil Mina in ${expense.currency}`)
				.locator('xpath=..');
			await expect(shareGroup).toContainText(expense.currency);
			await expect(shareGroup).not.toContainText('€');
			const manualSummary = dialog.getByText('Summe:').locator('xpath=..');
			await expect(manualSummary).toContainText(splitCurrencyLabels[expense.currency]);
			await expect(manualSummary).not.toContainText('€');
			for (const theme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await expect
					.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
					.toBe(theme === 'dark');
				for (const width of [320, 360]) {
					await expectNoHorizontalOverflow(page, width, [amountGroup, shareGroup, manualSummary]);
				}
			}
			await page.getByRole('button', { name: 'Aufteilung: Gleichmäßig', exact: true }).click();
			const splitReview = dialog.getByRole('list', { name: 'Anteile vor dem Speichern' });
			await expect(splitReview).toContainText(splitCurrencyLabels[expense.currency]);
			await expect(splitReview).not.toContainText('€');

			for (const theme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await expect
					.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
					.toBe(theme === 'dark');
				for (const width of [320, 360]) {
					await expectNoHorizontalOverflow(page, width, [amountGroup, splitReview]);
				}
			}

			// Back on the saved equal split, so nothing changed and closing asks nothing.
			await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
			await expect(page.getByRole('alertdialog')).toBeHidden();
			await expect(dialog).toBeHidden();
		}
	});
});

test.describe('expense edit payer', () => {
	skipUnlessFixtures();

	const SHARE_CODE = FIXTURE_WG.shareCode;
	const MEMBER = {
		id: FIXTURE_WG.memberId,
		name: FIXTURE_WG.memberName,
		color: null,
		active: true,
	};
	const INACTIVE_MEMBER = {
		id: 'fixture-inactive-member',
		name: 'Ben',
		color: null,
		active: false,
	};
	const SECOND_ACTIVE_MEMBER = {
		id: 'fixture-second-active-member',
		name: 'Cara',
		color: null,
		active: true,
	};
	const MEMBERS = [MEMBER, SECOND_ACTIVE_MEMBER, INACTIVE_MEMBER];

	const expense: Expense = {
		id: 'fixture-expense-edit-payer',
		paidByMemberId: MEMBER.id,
		category: 'sonstiges',
		amountCents: 1250,
		currency: 'EUR',
		description: 'Payer contract test',
		imageUrl: null,
		occurredAt: '2026-09-25T10:00:00.000Z',
		createdAt: '2026-09-25T10:00:00.000Z',
		updatedAt: '2026-09-25T10:00:00.000Z',
		splits: [
			{
				id: 'fixture-expense-edit-payer-split',
				debtorMemberId: MEMBER.id,
				amountCents: 1000,
				settledAt: null,
			},
			{
				id: 'fixture-expense-edit-payer-inactive-split',
				debtorMemberId: INACTIVE_MEMBER.id,
				amountCents: 250,
				settledAt: null,
			},
		],
	};
	const activeOnlyExpense: Expense = {
		...expense,
		id: 'fixture-expense-active-only',
		amountCents: 1200,
		description: 'Active-only split',
		splits: [
			{
				id: 'fixture-expense-active-only-first-split',
				debtorMemberId: MEMBER.id,
				amountCents: 1000,
				settledAt: null,
			},
			{
				id: 'fixture-expense-active-only-second-split',
				debtorMemberId: SECOND_ACTIVE_MEMBER.id,
				amountCents: 200,
				settledAt: null,
			},
		],
	};

	async function openAusgaben(page: import('@playwright/test').Page, expenses: Expense[]) {
		await setupMember(page);
		await page.route(`**/api/wg/${SHARE_CODE}/members`, (route) =>
			route.fulfill({ json: { members: MEMBERS, viewerIsAdmin: false } }),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/expenses**`, (route) =>
			route.request().method() === 'PATCH'
				? route.fulfill({ json: { expense: expenses[0] ?? expense } })
				: route.fulfill({ json: { expenses, payments: [] } }),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/recurring-expenses*`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${SHARE_CODE}`);
		await navigateToFeature(page, `/wg/${SHARE_CODE}/ausgaben`);
		await dismissOnboarding(page);
	}

	test('keeps the payer selectable while creating an expense', async ({ page }) => {
		await openAusgaben(page, []);
		await page.getByRole('button', { name: 'Ausgabe hinzufügen' }).first().click();
		await expect(page.getByLabel('Bezahlt von')).toBeEnabled();
		await expect(page.getByLabel('Aufteilung: Gleichmäßig')).toBeEnabled();
	});

	test('preserves historical inactive shares on a description-only edit', async ({ page }) => {
		await openAusgaben(page, [expense]);
		await page.getByRole('button', { name: `Aktionen für ${expense.description}` }).click();
		await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();

		const patchRequest = page.waitForRequest(
			(request) =>
				request.method() === 'PATCH' &&
				request.url().endsWith(`/api/wg/${SHARE_CODE}/expenses/${expense.id}`),
		);
		await page.getByLabel('Beschreibung').fill('Reine Textkorrektur');
		await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		const body = (await patchRequest).postDataJSON();
		expect(body.splits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ debtorMemberId: INACTIVE_MEMBER.id, amountCents: 250 }),
			]),
		);
	});

	test('locks the payer and preserves departed shares while editing an expense', async ({
		page,
	}) => {
		await openAusgaben(page, [expense]);
		await page.getByRole('button', { name: `Aktionen für ${expense.description}` }).click();
		await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();

		await expect(page.getByLabel('Bezahlt von')).toBeDisabled();
		await expect(
			page.getByText(
				'Die zahlende Person kann bei einer bestehenden Ausgabe nicht geändert werden.',
			),
		).toBeVisible();
		const equalToggle = page.getByLabel('Aufteilung: Gleichmäßig');
		await expect(equalToggle).toBeDisabled();
		await expect(
			page.getByText(
				'Ausgezogene Anteile bleiben unverändert; nur aktive Personen übernehmen den Rest.',
			),
		).toBeVisible();
		const departedShare = page.getByRole('textbox', {
			name: 'Anteil Ben in Euro, ausgezogen. Anteil bleibt unverändert.',
		});
		await expect(departedShare).toBeDisabled();
		await page.getByRole('textbox', { name: `Anteil ${MEMBER.name} in Euro` }).fill('8,00');
		await page.getByRole('button', { name: 'Rest aufteilen', exact: true }).click();

		const patchRequest = page.waitForRequest(
			(request) =>
				request.method() === 'PATCH' &&
				request.url().endsWith(`/api/wg/${SHARE_CODE}/expenses/${expense.id}`),
		);
		await page.getByLabel('Beschreibung').fill('Geänderter Verwendungszweck');
		await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		const body = (await patchRequest).postDataJSON();
		expect(body.description).toBe('Geänderter Verwendungszweck');
		expect(body.splits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ debtorMemberId: INACTIVE_MEMBER.id, amountCents: 250 }),
			]),
		);
	});

	test('remainder distribution skips inactive members on every persisted edit', async ({
		page,
	}) => {
		await openAusgaben(page, [activeOnlyExpense]);
		await page
			.getByRole('button', { name: `Aktionen für ${activeOnlyExpense.description}` })
			.click();
		await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
		await page.getByLabel('Betrag').fill('14,00');
		await page.getByRole('button', { name: 'Rest aufteilen', exact: true }).click();

		const patchRequest = page.waitForRequest(
			(request) =>
				request.method() === 'PATCH' &&
				request.url().endsWith(`/api/wg/${SHARE_CODE}/expenses/${activeOnlyExpense.id}`),
		);
		await page.getByLabel('Beschreibung').fill('Aktive Anteile angepasst');
		await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		const body = (await patchRequest).postDataJSON();
		expect(
			body.splits.some(
				(split: { debtorMemberId: string }) => split.debtorMemberId === INACTIVE_MEMBER.id,
			),
		).toBe(false);
	});
});

test.describe('offline expense edit', () => {
	test('offline expense edits replay as a PATCH for the original expense', () => {
		const action = createQueuedExpenseUpdate({
			expenseId: 'expense-1',
			expectedUpdatedAt: '2026-09-19T10:00:00.000Z',
			shareCode: FIXTURE_WG.shareCode,
			memberId: 'member-1',
			description: 'Wocheneinkauf',
			amountCents: 1250,
			paidByMemberId: 'member-1',
			splits: [{ debtorMemberId: 'member-1', amountCents: 1250 }],
			imageUrl: null,
			now: Date.parse('2026-09-19T11:00:00.000Z'),
		});

		const request = getOfflineActionRequest(action);
		expect(action.type).toBe('expense.update');
		expect(request.method).toBe('PATCH');
		expect(request.path).toBe('/api/wg/MTE8PZAT/expenses/expense-1');
		expect(request.body).toMatchObject({
			expectedUpdatedAt: '2026-09-19T10:00:00.000Z',
			description: 'Wocheneinkauf',
		});
	});
});
