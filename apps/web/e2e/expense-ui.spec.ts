// Expense and subscription UI: row reflow, currency/payer edit, manual splits, finance dialogs, OCR, FAB overlay.
// Why: split and rounding input is the most error-prone user path; layouts must hold at 320px / 200% text.

import { type Locator, type Page, type Response, expect, test } from '@playwright/test';
import {
	createQueuedExpenseUpdate,
	getOfflineActionRequest,
} from '../src/core/offline/offline-queue';
import type { Expense } from '../src/features/expenses/components/ausgaben/expense-types';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.describe('expense row reflow', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
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
		await page.route(`**/api/wg/${shareCode}/chat/unread-count`, (route) =>
			route.fulfill({ json: { count: 0, overflow: false } }),
		);

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
					await page.keyboard.press('Escape');
				}
			}
		}
	});
});

test.describe('expense currency edit', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

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
		await page.route(`**/api/wg/${shareCode}/chat/unread-count`, (route) =>
			route.fulfill({ json: { count: 0, overflow: false } }),
		);

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

			await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
			const confirmClose = page.getByRole('alertdialog');
			await expect(confirmClose).toBeVisible();
			await confirmClose.getByRole('button', { name: 'Entwurf behalten', exact: true }).click();
			await expect(dialog).toBeHidden();
		}
	});
});

test.describe('expense edit payer', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

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
		await page.route(`**/api/wg/${SHARE_CODE}/chat/unread-count`, (route) =>
			route.fulfill({ json: { count: 0, overflow: false } }),
		);
		await navigateToFeature(page, `/wg/${SHARE_CODE}/ausgaben`);
		await dismissOnboarding(page);
	}

	test('keeps the payer selectable while creating an expense', async ({ page }) => {
		await openAusgaben(page, []);
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).first().click();
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

test.describe('manual split validation', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const INVALID_SPLIT_MESSAGE =
		'Mindestens ein Anteil ist ungültig. Gib einen gültigen Betrag ein oder lasse das Feld leer.';
	const MEMBERS = [
		{ id: FIXTURE_WG.memberId, name: 'Alexandra Beispielfamilienname', color: null, active: true },
		{ id: FIXTURE_WG.id, name: 'Maximilian Mustermann-Langname', color: null, active: true },
	];

	async function mockFinanceReads(page: Page): Promise<void> {
		const { shareCode } = FIXTURE_WG;
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({ json: { members: MEMBERS, viewerIsAdmin: false } }),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({ json: { expenses: [], payments: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/chat/unread-count`, (route) =>
			route.fulfill({ json: { count: 0, overflow: false } }),
		);
	}

	test('blocks an invalid manual expense share, then submits the corrected split', async ({
		page,
	}) => {
		const { shareCode } = FIXTURE_WG;
		let submitted: Record<string, unknown> | null = null;
		let postCount = 0;
		await page.setViewportSize({ width: 320, height: 640 });
		await setupMember(page);
		await mockFinanceReads(page);
		await page.route(`**/api/wg/${shareCode}/expenses`, async (route) => {
			if (route.request().method() === 'POST') {
				postCount += 1;
				submitted = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({ status: 500, json: { error: 'test_response' } });
				return;
			}
			await route.fulfill({ json: { expenses: [], payments: [] } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).first().click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Beschreibung', { exact: true }).fill('Internet');
		await dialog.getByLabel('Betrag', { exact: true }).fill('10');
		await dialog.getByRole('button', { name: 'Aufteilung: Manuell', exact: true }).click();
		const firstShare = dialog.getByLabel('Anteil Alexandra Beispielfamilienname in Euro');
		const invalidShare = dialog.getByLabel('Anteil Maximilian Mustermann-Langname in Euro');
		await firstShare.fill('10');
		await invalidShare.fill('-5');
		await dialog.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		await expect(dialog.getByText(INVALID_SPLIT_MESSAGE, { exact: true })).toBeVisible();
		await expect(firstShare).toHaveAttribute('aria-invalid', 'true');
		await expect(firstShare).toHaveAttribute('aria-describedby', 'expense-splits-error');
		expect((await invalidShare.boundingBox())?.width).toBeGreaterThan(0);
		expect(submitted).toBeNull();
		expect(postCount).toBe(0);

		await firstShare.fill('6');
		await invalidShare.fill('4');
		await dialog.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		await expect.poll(() => postCount).toBe(1);
		expect(submitted?.splits).toEqual([
			{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 600 },
			{ debtorMemberId: FIXTURE_WG.id, amountCents: 400 },
		]);
	});

	test('blocks a malformed manual Abo share, then submits the corrected split', async ({
		page,
	}) => {
		const { shareCode } = FIXTURE_WG;
		let submitted: Record<string, unknown> | null = null;
		let postCount = 0;
		await page.setViewportSize({ width: 320, height: 640 });
		await setupMember(page);
		await mockFinanceReads(page);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, async (route) => {
			if (route.request().method() === 'POST') {
				postCount += 1;
				submitted = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({ status: 500, json: { error: 'test_response' } });
				return;
			}
			await route.fulfill({ json: { recurringExpenses: [] } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/abos`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Neue Fixkosten' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Beschreibung', { exact: true }).fill('Internet');
		await dialog.getByLabel('Betrag', { exact: true }).fill('10');
		await dialog.getByRole('button', { name: 'Manuell', exact: true }).click();
		const firstShare = dialog.getByLabel('Anteil Alexandra Beispielfamilienname in Euro');
		const invalidShare = dialog.getByLabel('Anteil Maximilian Mustermann-Langname in Euro');
		await firstShare.fill('10');
		await invalidShare.fill('unbekannt');
		await dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
		await expect(dialog.getByText(INVALID_SPLIT_MESSAGE, { exact: true })).toBeVisible();
		await expect(invalidShare).toHaveAttribute('aria-invalid', 'true');
		await expect(invalidShare).toHaveAttribute('aria-describedby', 'abo-splits-error');
		expect((await invalidShare.boundingBox())?.width).toBeGreaterThan(0);
		expect(submitted).toBeNull();
		expect(postCount).toBe(0);

		await firstShare.fill('6');
		await invalidShare.fill('4');
		await dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
		await expect.poll(() => postCount).toBe(1);
		expect(submitted?.splits).toEqual([
			{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 600 },
			{ debtorMemberId: FIXTURE_WG.id, amountCents: 400 },
		]);
	});

	test('keeps blank and zero Abo shares opt-out while posting valid shares', async ({ page }) => {
		const { shareCode } = FIXTURE_WG;
		let submitted: Record<string, unknown> | null = null;
		let postCount = 0;
		await page.setViewportSize({ width: 360, height: 640 });
		await setupMember(page);
		await mockFinanceReads(page);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, async (route) => {
			if (route.request().method() === 'POST') {
				postCount += 1;
				submitted = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({ status: 500, json: { error: 'test_response' } });
				return;
			}
			await route.fulfill({ json: { recurringExpenses: [] } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/abos`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Neue Fixkosten' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Beschreibung', { exact: true }).fill('Internet');
		await dialog.getByLabel('Betrag', { exact: true }).fill('10');
		await dialog.getByRole('button', { name: 'Manuell', exact: true }).click();
		const firstShare = dialog.getByLabel('Anteil Alexandra Beispielfamilienname in Euro');
		const optOutShare = dialog.getByLabel('Anteil Maximilian Mustermann-Langname in Euro');
		await firstShare.fill('10');
		await dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
		await expect.poll(() => postCount).toBe(1);
		expect(submitted?.splits).toEqual([{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1000 }]);

		submitted = null;
		postCount = 0;
		await expect(
			dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }),
		).toBeEnabled();
		await optOutShare.fill('0');
		await dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
		await expect.poll(() => postCount).toBe(1);
		expect(submitted?.splits).toEqual([{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1000 }]);
	});
});

test.describe('finance dialog mobile', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	async function expectManualSplitLayout(
		page: Page,
		dialog: Locator,
		shareInputPrefix: 'share-' | 'abo-share-',
	): Promise<void> {
		const rows = dialog.locator(`[data-slot="field"]:has(input[id^="${shareInputPrefix}"])`);
		await expect(rows).toHaveCount(2);
		const cancelButton = page.getByRole('button', { name: 'Abbrechen', exact: true });
		for (const rootFontSize of [16, 32]) {
			await page.evaluate((size) => {
				document.documentElement.style.fontSize = `${size}px`;
			}, rootFontSize);
			await expect
				.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
				.toBe(`${rootFontSize}px`);
			for (const theme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await expect
					.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
					.toBe(theme === 'dark');
				for (const width of [320, 360, 390]) {
					await page.setViewportSize({ width, height: 740 });
					const layout = await dialog.evaluate((element) => ({
						clientWidth: element.clientWidth,
						scrollWidth: element.scrollWidth,
					}));
					expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					const cancelBounds = await cancelButton.boundingBox();
					expect(cancelBounds).not.toBeNull();
					if (cancelBounds) expect(cancelBounds.x + cancelBounds.width).toBeLessThanOrEqual(width);
					const metrics = await rows.evaluateAll((elements) =>
						elements.map((element) => {
							const row = element as HTMLElement;
							const label = row.querySelector<HTMLElement>('[data-slot="field-label"]');
							const amount = row.querySelector<HTMLElement>('[data-slot="input-group"]');
							if (!label || !amount) return null;
							const labelBounds = label.getBoundingClientRect();
							const amountBounds = amount.getBoundingClientRect();
							return {
								clientWidth: row.clientWidth,
								scrollWidth: row.scrollWidth,
								direction: getComputedStyle(row).flexDirection,
								labelWidth: labelBounds.width,
								labelRight: labelBounds.right,
								labelTop: labelBounds.top,
								labelBottom: labelBounds.bottom,
								amountLeft: amountBounds.left,
								amountTop: amountBounds.top,
								amountBottom: amountBounds.bottom,
								amountWidth: amountBounds.width,
							};
						}),
					);
					expect(metrics.every((metric) => metric !== null)).toBe(true);
					for (const metric of metrics) {
						if (!metric) throw new Error('Manual share field layout could not be measured');
						expect(
							metric.labelWidth,
							JSON.stringify({ width, rootFontSize, metric }),
						).toBeGreaterThan(0);
						expect(metric.direction).toBe('column');
						expect(metric.scrollWidth).toBeLessThanOrEqual(metric.clientWidth + 1);
						const overlaps =
							metric.labelRight > metric.amountLeft + 1 &&
							metric.labelBottom > metric.amountTop + 1 &&
							metric.labelTop < metric.amountBottom - 1;
						expect(overlaps).toBe(false);
					}
				}
			}
		}
		await page.evaluate(() => {
			document.documentElement.style.fontSize = '16px';
		});
		await page.setViewportSize({ width: 1440, height: 900 });
		const wideMetrics = await rows.first().evaluate((element) => {
			const row = element as HTMLElement;
			const amount = row.querySelector<HTMLElement>('[data-slot="input-group"]');
			return {
				direction: getComputedStyle(row).flexDirection,
				amountWidth: amount?.getBoundingClientRect().width ?? 0,
			};
		});
		expect(wideMetrics.direction).toBe('row');
		expect(wideMetrics.amountWidth).toBeCloseTo(128, 0);
	}

	test('keeps finance forms in narrow viewports at 200% text size', async ({ page }) => {
		const { shareCode, id, memberId } = FIXTURE_WG;
		await setupMember(page);
		await page.setViewportSize({ width: 320, height: 640 });
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: memberId, name: 'Alexandra von Hohenlohe-Waldberg', color: null, active: true },
						{ id, name: 'Maximilian-Wilhelm Demonstrationshausen', color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({ json: { expenses: [], payments: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/chat/unread-count`, (route) =>
			route.fulfill({ json: { count: 0, overflow: false } }),
		);

		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).first().click();
		const expenseDialog = page.getByRole('dialog');
		await expect(expenseDialog).toBeVisible();
		await expenseDialog.getByText('Manuell', { exact: true }).click();
		await expectManualSplitLayout(page, expenseDialog, 'share-');
		await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Entwurf verwerfen' }).click();
		await expect(expenseDialog).toBeHidden();

		await page.goto(`/wg/${shareCode}/abos`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Neue Fixkosten' }).click();
		const aboDialog = page.getByRole('dialog');
		await expect(aboDialog).toBeVisible();
		await aboDialog.getByText('Manuell', { exact: true }).click();
		await expectManualSplitLayout(page, aboDialog, 'abo-share-');
		await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
		await expect(aboDialog).toBeHidden();
	});
});

test.describe('ocr runtime', () => {
	const OCR_LANGUAGE_DATA_URLS = [
		'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz',
		'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
	];
	// Tesseract.js-core 5.1.1 tries an optional fetch of its embedded WASM data URI.
	// WebKit blocks it via connect-src, then successfully falls back to decoding
	// the same bytes. Match only that exact message and WASM magic prefix; do not
	// permit data: URLs in CSP.
	const WEBKIT_WASM_DATA_CSP_MESSAGE =
		'Refused to connect to data:application/octet-stream;base64,<embedded-wasm> because it does not appear in the connect-src directive of the Content Security Policy.';
	const WEBKIT_WASM_DATA_CSP_PATTERN =
		/^Refused to connect to data:application\/octet-stream;base64,(AGFzbQE[A-Za-z0-9+/=]*(?:\.{3}[A-Za-z0-9+/=]*)?) because it does not appear in the connect-src directive of the Content Security Policy\.$/;

	function isExpectedWebKitWasmDataCsp(message: string): boolean {
		return WEBKIT_WASM_DATA_CSP_PATTERN.test(message.trimEnd());
	}

	const IMPORT_PATH = `/wg/${FIXTURE_WG.shareCode}/import`;
	const FIXTURE_ENV_ENABLED =
		process.env.E2E_FIXTURE_MODE === 'true' &&
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE === 'true' &&
		process.env.NEXT_PUBLIC_DB_DOWN === 'true' &&
		process.env.PLAYWRIGHT_USE_BUILD === 'true';

	test.skip(
		process.env.OCR_RUNTIME_E2E !== 'true' || !FIXTURE_ENV_ENABLED,
		'OCR runtime proof is opt-in: set OCR_RUNTIME_E2E=true with the production fixture build. The real Tesseract worker, WASM core, and German/English models require public access to cdn.jsdelivr.net.',
	);
	test.use({ serviceWorkers: 'block' });

	interface NetworkEvidence {
		cdnResponses: Map<string, number>;
		cspViolations: string[];
		pageErrors: string[];
		apiWrites: string[];
	}

	function observeNetwork(page: Page): NetworkEvidence {
		const evidence: NetworkEvidence = {
			cdnResponses: new Map(),
			cspViolations: [],
			pageErrors: [],
			apiWrites: [],
		};

		page.context().on('response', (response) => {
			if (response.url().startsWith('https://cdn.jsdelivr.net/')) {
				evidence.cdnResponses.set(response.url(), response.status());
			}
		});
		page.context().on('request', (request) => {
			if (request.method() === 'GET') return;
			const path = new URL(request.url()).pathname;
			if (path.startsWith('/api/')) {
				evidence.apiWrites.push(`${request.method()} ${path}`);
			}
		});
		page.on('console', (message) => {
			if (
				message.type() === 'error' &&
				/Content Security Policy|Refused to (?:compile|load|execute)/i.test(message.text())
			) {
				const text = message.text();
				if (isExpectedWebKitWasmDataCsp(text)) {
					evidence.cspViolations.push(WEBKIT_WASM_DATA_CSP_MESSAGE);
				} else {
					evidence.cspViolations.push(
						text.length > 512 ? `${text.slice(0, 256)}…${text.slice(-256)}` : text,
					);
				}
			}
		});
		page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
		return evidence;
	}

	function cspSources(policy: string, name: string): string[] {
		const directive = policy
			.split(';')
			.map((entry) => entry.trim())
			.find((entry) => entry.startsWith(`${name} `));
		return directive?.slice(name.length).trim().split(/\s+/) ?? [];
	}

	function expectStrictOcrPolicy(response: Response): void {
		const csp = response.headers()['content-security-policy'];
		expect(csp).toBeTruthy();
		const scriptSrc = cspSources(csp ?? '', 'script-src');
		const connectSrc = cspSources(csp ?? '', 'connect-src');

		expect(scriptSrc).toContain("'wasm-unsafe-eval'");
		expect(scriptSrc).not.toContain("'unsafe-eval'");
		expect(connectSrc).toContain(OCR_LANGUAGE_DATA_URLS[0]);
		expect(connectSrc).toContain(OCR_LANGUAGE_DATA_URLS[1]);
		expect(connectSrc).not.toContain('https://cdn.jsdelivr.net');
	}

	function expectOnlyExpectedCspViolations(
		violations: readonly string[],
		browserName: string,
	): void {
		const unexpected = violations.filter(
			(message) => browserName !== 'webkit' || message !== WEBKIT_WASM_DATA_CSP_MESSAGE,
		);
		expect(unexpected).toEqual([]);
	}

	async function openOcrImport(page: Page): Promise<Response> {
		await setupMember(page);
		const documentResponse = page.waitForResponse(
			(response) =>
				response.request().resourceType() === 'document' &&
				new URL(response.url()).pathname === IMPORT_PATH,
		);
		await navigateToFeature(page, IMPORT_PATH);
		await dismissOnboarding(page);
		const response = await documentResponse;
		expect(response.status()).toBe(200);
		expectStrictOcrPolicy(response);

		await page.getByRole('button', { name: /Screenshot/i }).click();
		await expect(page.locator('#import-screenshot')).toBeVisible();
		return response;
	}

	async function uploadSyntheticReceipt(page: Page): Promise<void> {
		const base64 = await page.evaluate(() => {
			const canvas = document.createElement('canvas');
			canvas.width = 1000;
			canvas.height = 600;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Canvas 2D context unavailable');
			context.fillStyle = '#fff';
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = '#000';
			context.font = '38px Arial';
			['TEST RECEIPT', '27.09.2026', 'Milch 2,50 EUR', 'Brot 3,20 EUR', 'TOTAL 5,70 EUR'].forEach(
				(line, index) => context.fillText(line, 60, 85 + index * 85),
			);
			return canvas.toDataURL('image/png').split(',')[1] ?? '';
		});
		if (!base64) throw new Error('Synthetic receipt PNG was not generated');
		await page.locator('#import-screenshot').setInputFiles({
			name: 'synthetic-receipt.png',
			mimeType: 'image/png',
			buffer: Buffer.from(base64, 'base64'),
		});
	}

	function expectTesseractAssets(cdnResponses: Map<string, number>): void {
		const urls = [...cdnResponses.keys()];
		const paths = urls.map((url) => new URL(url).pathname);
		const workerPath = '/npm/tesseract.js@v5.1.1/dist/worker.min.js';
		const corePath = /^\/npm\/tesseract\.js-core@v5\.1\.1\/tesseract-core(?:-[^/]+)?\.wasm\.js$/;
		const deuPath = new URL(OCR_LANGUAGE_DATA_URLS[0]).pathname;
		const engPath = new URL(OCR_LANGUAGE_DATA_URLS[1]).pathname;

		expect(paths).toContain(workerPath);
		expect(paths.some((path) => corePath.test(path))).toBe(true);
		expect(paths).toContain(deuPath);
		expect(paths).toContain(engPath);
		for (const path of [workerPath, deuPath, engPath]) {
			const url = `https://cdn.jsdelivr.net${path}`;
			expect(cdnResponses.get(url), `${url} returns HTTP 200`).toBe(200);
		}
		const coreUrl = urls.find((url) => corePath.test(new URL(url).pathname));
		expect(coreUrl).toBeTruthy();
		expect(cdnResponses.get(coreUrl ?? '')).toBe(200);
	}

	test('real Tesseract recognizes a local receipt under the strict CSP', async ({
		page,
		browserName,
	}) => {
		test.setTimeout(90_000);
		const evidence = observeNetwork(page);
		await openOcrImport(page);
		await uploadSyntheticReceipt(page);

		const recognizedData = page.locator('#import-ocr');
		await expect.poll(() => recognizedData.inputValue(), { timeout: 55_000 }).toContain('TOTAL');
		const recognizedText = await recognizedData.inputValue();
		expect(recognizedText).toMatch(/Milch/i);
		expect(recognizedText).toContain('5,70');
		await expect(
			page.getByText('Bild wird ausgewertet. Das kann 30 Sekunden dauern.', { exact: true }),
		).toHaveCount(0);

		expectTesseractAssets(evidence.cdnResponses);
		expectOnlyExpectedCspViolations(evidence.cspViolations, browserName);
		expect(evidence.pageErrors).toEqual([]);
		expect(evidence.apiWrites).toEqual([]);
	});

	test('blocked Tesseract language downloads show bounded recovery guidance', async ({
		page,
		browserName,
	}) => {
		test.setTimeout(75_000);
		const blockedModelRequests: string[] = [];
		for (const url of OCR_LANGUAGE_DATA_URLS) {
			await page.context().route(url, (route) => {
				blockedModelRequests.push(route.request().url());
				return route.abort();
			});
		}
		const evidence = observeNetwork(page);
		await openOcrImport(page);
		await uploadSyntheticReceipt(page);

		const recovery = page.getByText(/Texterkennung konnte nicht (geladen|initialisiert) werden/);
		await expect(recovery).toBeVisible({ timeout: 45_000 });
		const recoveryText = (await recovery.textContent()) ?? '';
		expect(recoveryText).toMatch(/Internetverbindung/);
		expect(recoveryText).toMatch(/lade die Seite neu|versuche es erneut/i);
		await expect(page.locator('#import-screenshot')).toBeEnabled();
		await expect(
			page.getByText('Bild wird ausgewertet. Das kann 30 Sekunden dauern.', { exact: true }),
		).toHaveCount(0);

		expect(blockedModelRequests.length).toBeGreaterThan(0);
		expectOnlyExpectedCspViolations(evidence.cspViolations, browserName);
		expect(evidence.apiWrites).toEqual([]);
	});
});

test.describe('fab summary overlay', () => {
	test.skip(
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
		'requires the local fixture server',
	);

	const SHARE_CODE = 'MTE8PZAT';

	async function useLargeText(page: Page): Promise<void> {
		await page.evaluate(() => {
			document.documentElement.style.setProperty('font-size', '32px', 'important');
		});
		await page.waitForFunction(
			() => getComputedStyle(document.documentElement).fontSize === '32px',
		);
	}

	for (const width of [320, 360]) {
		for (const colorScheme of ['light', 'dark'] as const) {
			test(`floating action leaves the monthly summary visible at ${width}px, ${colorScheme}, 200% text`, async ({
				page,
			}, testInfo) => {
				await page.setViewportSize({ width, height: 740 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				await navigateToFeature(page, `/wg/${SHARE_CODE}/abos`);
				await useLargeText(page);
				await dismissOnboarding(page);
				await expect(page.getByRole('heading', { name: 'Fixkosten', exact: true })).toBeVisible();
				await expect(page.getByText('Dein Anteil', { exact: true })).toBeVisible();
				const actionButton = page.getByRole('button', { name: 'Neue Fixkosten', exact: true });
				await expect(actionButton).toBeVisible();
				await expect(actionButton).toHaveAccessibleName('Neue Fixkosten');

				const geometry = {
					rootFontSize: await page.evaluate(
						() => getComputedStyle(document.documentElement).fontSize,
					),
					actionFontSize: await actionButton.evaluate(
						(button) => getComputedStyle(button).fontSize,
					),
					actionPointerEvents: await actionButton.evaluate(
						(button) => getComputedStyle(button).pointerEvents,
					),
					wrapperPointerEvents: await page
						.locator('[data-page-primary-action]')
						.evaluate((wrapper) => getComputedStyle(wrapper).pointerEvents),
					hitArea: await actionButton.evaluate((button) => {
						const style = getComputedStyle(button, '::after');
						return { width: style.width, height: style.height, minWidth: style.minWidth };
					}),
					iconAlignment: await actionButton.evaluate((button) => {
						const buttonBox = button.getBoundingClientRect();
						const iconBox = button.querySelector('svg.lucide-plus')?.getBoundingClientRect();
						return iconBox
							? {
									x: Math.abs(
										buttonBox.left + buttonBox.width / 2 - (iconBox.left + iconBox.width / 2),
									),
									y: Math.abs(
										buttonBox.top + buttonBox.height / 2 - (iconBox.top + iconBox.height / 2),
									),
								}
							: null;
					}),
					action: await actionButton.boundingBox().then(
						(box) =>
							box && {
								top: box.y,
								right: box.x + box.width,
								bottom: box.y + box.height,
								left: box.x,
								width: box.width,
								height: box.height,
							},
					),
					pointerTargets: await page.evaluate(() => {
						const wrapper = document.querySelector<HTMLElement>('[data-page-primary-action]');
						const button = wrapper?.querySelector<HTMLElement>('button');
						if (!wrapper || !button) return { centerTargetsButton: false, gapPassesThrough: false };
						const wrapperBox = wrapper.getBoundingClientRect();
						const buttonBox = button.getBoundingClientRect();
						const center = document.elementFromPoint(
							buttonBox.left + buttonBox.width / 2,
							buttonBox.top + buttonBox.height / 2,
						);
						const gap = document.elementFromPoint(
							(wrapperBox.left + buttonBox.left) / 2,
							buttonBox.top + buttonBox.height / 2,
						);
						return {
							centerTargetsButton: center?.closest('button') === button,
							gapPassesThrough: gap?.closest('[data-page-primary-action]') !== wrapper,
						};
					}),
					amounts: await page.evaluate(() => {
						const label = Array.from(document.querySelectorAll('p')).find(
							(element) => element.textContent?.trim() === 'Dein Anteil',
						);
						const textElements = [
							label,
							...Array.from(label?.parentElement?.querySelectorAll('p') ?? []).filter(
								(element) => element !== label,
							),
						].filter(
							(element): element is HTMLParagraphElement => element instanceof HTMLParagraphElement,
						);
						return textElements.flatMap((element) => {
							const range = document.createRange();
							range.selectNodeContents(element);
							return Array.from(range.getClientRects()).map((rect) => {
								const { top, right, bottom, left } = rect;
								return { top, right, bottom, left };
							});
						});
					}),
				};
				await page.screenshot({
					path: testInfo.outputPath(`fab-${width}-${colorScheme}.png`),
					fullPage: true,
				});

				expect(geometry.rootFontSize).toBe('32px');
				expect(geometry.action).not.toBeNull();
				expect(geometry.action?.width).toBe(44);
				expect(geometry.action?.height).toBe(44);
				expect(geometry.amounts.length).toBeGreaterThan(0);
				const overlapsAmount = geometry.amounts.some(
					(amount) =>
						geometry.action !== null &&
						amount.left < geometry.action.right &&
						amount.right > geometry.action.left &&
						amount.top < geometry.action.bottom &&
						amount.bottom > geometry.action.top,
				);
				expect(overlapsAmount, JSON.stringify(geometry)).toBe(false);
				expect(geometry.actionFontSize).toBe('0px');
				expect(geometry.actionPointerEvents).toBe('auto');
				expect(geometry.wrapperPointerEvents).toBe('none');
				expect(geometry.hitArea).toEqual({ width: '44px', height: '44px', minWidth: '44px' });
				expect(geometry.iconAlignment?.x).toBeLessThanOrEqual(1);
				expect(geometry.iconAlignment?.y).toBeLessThanOrEqual(1);
				expect(geometry.pointerTargets.centerTargetsButton).toBe(true);
				expect(geometry.pointerTargets.gapPassesThrough).toBe(true);

				await page.evaluate(() => window.scrollBy(0, 100));
				await expect(actionButton).toBeVisible();
				const scrolledAmounts = await page.evaluate(() => {
					const label = Array.from(document.querySelectorAll('p')).find(
						(element) => element.textContent?.trim() === 'Dein Anteil',
					);
					const textElements = [
						label,
						...Array.from(label?.parentElement?.querySelectorAll('p') ?? []).filter(
							(element) => element !== label,
						),
					].filter(
						(element): element is HTMLParagraphElement => element instanceof HTMLParagraphElement,
					);
					return textElements.flatMap((element) => {
						const range = document.createRange();
						range.selectNodeContents(element);
						return Array.from(range.getClientRects()).map((rect) => {
							const { top, right, bottom, left } = rect;
							return { top, right, bottom, left };
						});
					});
				});
				const actionAfterScroll = await actionButton.boundingBox();
				const overlapsAfterScroll = scrolledAmounts.some(
					(amount) =>
						actionAfterScroll !== null &&
						amount.left < actionAfterScroll.x + actionAfterScroll.width &&
						amount.right > actionAfterScroll.x &&
						amount.top < actionAfterScroll.y + actionAfterScroll.height &&
						amount.bottom > actionAfterScroll.y,
				);
				expect(overlapsAfterScroll, JSON.stringify({ scrolledAmounts, actionAfterScroll })).toBe(
					false,
				);

				await page.keyboard.press('Tab');
				const focusMetrics = await actionButton.evaluate((element) => {
					element.focus();
					const style = getComputedStyle(element);
					return {
						focusVisible: element.matches(':focus-visible'),
						outline: style.outlineStyle,
						boxShadow: style.boxShadow,
					};
				});
				expect(focusMetrics.focusVisible).toBe(true);
				expect(focusMetrics.outline !== 'none' || focusMetrics.boxShadow !== 'none').toBe(true);
			});
		}
	}

	test('compact plus actions keep their names and skip nested and text-only actions', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 740 });
		await setupMember(page);
		for (const [feature, label] of [
			['kalender', 'Termin hinzufügen'],
			['vorraete', 'Vorrat hinzufügen'],
			['pinnwand', 'Beitrag erstellen'],
			['putzen', 'Putzaufgabe erfassen'],
			['ausgaben', 'Ausgabe erfassen'],
		] as const) {
			await navigateToFeature(page, `/wg/${SHARE_CODE}/${feature}`);
			await useLargeText(page);
			await dismissOnboarding(page);
			const action = page.getByRole('button', { name: label, exact: true });
			await expect(action).toBeVisible();
			const box = await action.boundingBox();
			expect(box?.width).toBe(44);
			expect(box?.height).toBe(44);
		}

		await navigateToFeature(page, `/wg/${SHARE_CODE}/einkauf`);
		await useLargeText(page);
		await dismissOnboarding(page);
		await expect(page.locator('[data-page-primary-action] > button')).toHaveCount(0);
		const addItem = page.getByRole('button', { name: 'Artikel hinzufügen', exact: true });
		await expect(addItem).toBeVisible();
		const itemName = page.getByRole('textbox', { name: 'Artikel-Name' });
		await itemName.focus();
		await expect(itemName).toBeFocused();

		// Eine offene Forderung blendet auf „Erinnerungen“ den reinen Text-Button „Erinnern“ ein.
		const createdAt = new Date().toISOString();
		await page.route(`**/api/wg/${SHARE_CODE}/expenses`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({
						json: {
							payments: [],
							expenses: [
								{
									id: 'fab-text-action-expense',
									paidByMemberId: FIXTURE_WG.memberId,
									amountCents: 2000,
									currency: 'EUR',
									description: 'Einkauf',
									imageUrl: null,
									occurredAt: createdAt,
									createdAt,
									updatedAt: createdAt,
									splits: [
										{
											id: 'fab-text-action-split',
											debtorMemberId: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
											amountCents: 1000,
											settledAt: null,
										},
									],
								},
							],
						},
					})
				: route.continue(),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/reminders`, (route) =>
			route.fulfill({ json: { reminders: [] } }),
		);
		await navigateToFeature(page, `/wg/${SHARE_CODE}/mahnungen`);
		await useLargeText(page);
		await dismissOnboarding(page);
		// RemindButton legt den Button in einen Wrapper; das FAB-CSS greift nur auf direkte Kinder.
		const textAction = page.locator('[data-page-primary-action] button');
		await expect(textAction).toHaveCount(1);
		await expect(textAction).toBeVisible();
		expect(await textAction.evaluate((button) => getComputedStyle(button).fontSize)).not.toBe(
			'0px',
		);
	});
});

test.describe('subscription summary responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
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
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
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

		await page.getByRole('button', { name: 'Neue Fixkosten' }).click();
		const dialog = page.getByRole('dialog', { name: 'Neue Fixkosten' });
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByText('Fixkosten konnten nicht gelöscht werden', { exact: false }),
		).toHaveCount(0);
	});
});

test.describe('offline expense edit', () => {
	test('offline expense edits replay as a PATCH for the original expense', () => {
		const action = createQueuedExpenseUpdate({
			expenseId: 'expense-1',
			expectedUpdatedAt: '2026-09-19T10:00:00.000Z',
			shareCode: 'MTE8PZAT',
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

test.describe('date integrity ui', () => {
	test.skip(
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
		'requires the local fixture server',
	);

	const SHARE_CODE = 'MTE8PZAT';
	const MOBILE_VIEWPORT = { width: 320, height: 740 } as const;

	type CapturedPost = {
		bodies: unknown[];
		statuses: number[];
	};

	function berlinCalendarDate(value: string): string {
		const parts = Object.fromEntries(
			new Intl.DateTimeFormat('en', {
				timeZone: 'Europe/Berlin',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
			})
				.formatToParts(new Date(value))
				.map(({ type, value: part }) => [type, part]),
		);
		return `${parts.year}-${parts.month}-${parts.day}`;
	}

	async function interceptValidationPost(page: Page, endpoint: string): Promise<CapturedPost> {
		const captured: CapturedPost = { bodies: [], statuses: [] };
		await page.route(`**/api/wg/${SHARE_CODE}/${endpoint}`, async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}
			captured.bodies.push(route.request().postDataJSON());
			await route.fulfill({
				status: 422,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'deliberate_validation' }),
			});
			captured.statuses.push(422);
		});
		return captured;
	}

	async function openAboCreate(
		page: Page,
		viewport: { width: number; height: number },
	): Promise<void> {
		await page.setViewportSize(viewport);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${SHARE_CODE}/abos`);
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Fixkosten', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Neue Fixkosten', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Neue Fixkosten', exact: true })).toBeVisible();
	}

	async function openCalendarCreate(
		page: Page,
		viewport: { width: number; height: number },
	): Promise<void> {
		await page.setViewportSize(viewport);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${SHARE_CODE}/kalender`);
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Kalender', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Termin hinzufügen', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Neuer Termin', exact: true })).toBeVisible();
	}

	test('Abo blocks a missing due date and preserves a valid calendar date', async ({ page }) => {
		const post = await interceptValidationPost(page, 'recurring-expenses');
		await openAboCreate(page, MOBILE_VIEWPORT);

		await page.getByLabel('Beschreibung').fill('Netflix');
		await page.getByLabel('Betrag').fill('12,34');
		const dueDate = page.getByLabel('Erste Fälligkeit');
		await dueDate.fill('');
		await page.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();

		expect(post.bodies).toHaveLength(0);
		await expect(dueDate).toBeFocused();
		await expect(dueDate).toHaveValue('');
		await expect
			.poll(() => dueDate.evaluate((input) => (input as HTMLInputElement).validity.valid))
			.toBe(false);

		await dueDate.fill('2026-09-22');
		await expect(dueDate).toHaveValue('2026-09-22');
		await page.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
		await expect.poll(() => post.bodies.length).toBe(1);
		await expect.poll(() => post.statuses.length).toBe(1);

		const payload = post.bodies[0] as { nextDueAt: string };
		expect(berlinCalendarDate(payload.nextDueAt)).toBe('2026-09-22');
	});

	test('calendar all-day creation keeps start and end on the same calendar day', async ({
		page,
	}) => {
		const post = await interceptValidationPost(page, 'events');
		await openCalendarCreate(page, MOBILE_VIEWPORT);

		await page.getByLabel('Titel').fill('WG-Termin');
		const start = page.getByLabel('Beginn');
		const end = page.getByLabel('Ende (optional)');
		await start.fill('2026-09-22T14:00');
		await end.fill('2026-09-22T15:00');
		await page.getByRole('checkbox', { name: 'Ganztägig', exact: true }).click();

		await expect(start).toHaveValue('2026-09-22');
		await expect(end).toHaveValue('2026-09-22');
		await page.getByRole('button', { name: 'Termin speichern', exact: true }).click();
		await expect.poll(() => post.bodies.length).toBe(1);
		await expect.poll(() => post.statuses.length).toBe(1);

		const payload = post.bodies[0] as {
			allDay: boolean;
			startsAt: string;
			endsAt: string | null;
		};
		expect(payload.allDay).toBe(true);
		expect(payload.endsAt).not.toBeNull();
		expect(berlinCalendarDate(payload.startsAt)).toBe('2026-09-22');
		expect(berlinCalendarDate(payload.endsAt as string)).toBe('2026-09-22');
		await expect(page.getByText('Endzeit liegt vor Startzeit.', { exact: true })).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'Neuer Termin', exact: true })).toBeVisible();
		await expect(page.getByText('0 WG-Termine', { exact: true })).toBeVisible();
	});

	test.describe('absence dates outside Berlin', () => {
		test.use({ timezoneId: 'America/Los_Angeles' });

		test('uses Berlin day boundaries across the spring clock change', async ({ page }) => {
			const post = await interceptValidationPost(page, 'absences');
			await setupMember(page);
			await navigateToFeature(page, `/wg/${SHARE_CODE}/putzen?panel=absences`);
			await dismissOnboarding(page);

			await page.getByLabel('Abwesenheit von').fill('2026-03-29');
			await page.getByLabel('Abwesenheit bis').fill('2026-03-30');
			await page.getByRole('button', { name: 'Abwesenheit speichern' }).click();
			await expect.poll(() => post.bodies.length).toBe(1);

			expect(post.bodies[0]).toMatchObject({
				startDate: '2026-03-28T23:00:00.000Z',
				endDate: '2026-03-30T21:59:59.999Z',
			});
		});
	});

	test('new calendar event starts at the next full hour', async ({ page }) => {
		await page.clock.setFixedTime(new Date('2026-09-22T08:20:00Z'));
		await openCalendarCreate(page, MOBILE_VIEWPORT);
		await expect(page.getByLabel('Beginn')).toHaveValue('2026-09-22T11:00');
	});

	test('picking a past day in the month view keeps that day for the new event', async ({
		page,
	}) => {
		await page.clock.setFixedTime(new Date('2026-09-22T08:20:00Z'));
		await page.setViewportSize(MOBILE_VIEWPORT);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${SHARE_CODE}/kalender`);
		await dismissOnboarding(page);
		await page.getByRole('tab', { name: 'Monat', exact: true }).click();
		await page
			.getByRole('button', { name: 'Donnerstag, 10. September 2026', exact: false })
			.click();
		await page.getByRole('button', { name: 'Termin hinzufügen', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Neuer Termin', exact: true })).toBeVisible();
		// The day picked in the calendar (in the past) must not be silently
		// discarded back to "today" — only the time-of-day defaults.
		await expect(page.getByLabel('Beginn')).toHaveValue('2026-09-10T11:00');
	});

	test('calendar reports a missing start only on save and leaves the end unchanged', async ({
		page,
	}) => {
		const post = await interceptValidationPost(page, 'events');
		await openCalendarCreate(page, MOBILE_VIEWPORT);
		await page.getByLabel('Titel').fill('WG-Termin');

		const start = page.getByLabel('Beginn');
		const end = page.getByLabel('Ende (optional)');
		await start.fill('2026-09-22T14:00');
		await end.fill('2026-09-22T15:00');
		await start.fill('');

		await expect(end).toHaveValue('2026-09-22T15:00');
		await expect(page.getByText('Startzeitpunkt fehlt.', { exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Termin speichern', exact: true }).click();

		expect(post.bodies).toHaveLength(0);
		await expect(start).toBeFocused();
		await expect
			.poll(() => start.evaluate((input) => (input as HTMLInputElement).validity.valueMissing))
			.toBe(true);
		await expect(start).toHaveValue('');
		await expect(end).toHaveValue('2026-09-22T15:00');
	});

	test('legacy all-day title-only edit preserves the displayed date and both stored timestamps', async ({
		page,
	}) => {
		await page.clock.setFixedTime(new Date('2026-09-20T10:00:00Z'));
		await setupMember(page);
		const legacy = {
			id: 'legacy-date',
			title: 'Alter Geburtstag',
			description: null,
			startsAt: '2026-09-21T22:00:00.000Z',
			endsAt: '2026-09-22T21:00:00.000Z',
			allDay: true,
			location: null,
			recurrence: null,
		};
		let saved: unknown;
		await page.route(`**/api/wg/${SHARE_CODE}/events*`, (route) =>
			route.fulfill({ json: { events: [legacy] } }),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/events/${legacy.id}`, (route) => {
			saved = route.request().postDataJSON();
			return route.fulfill({ json: { event: { ...legacy, ...route.request().postDataJSON() } } });
		});
		await navigateToFeature(page, `/wg/${SHARE_CODE}/kalender`);
		await expect(
			page
				.getByRole('list', { name: /Dienstag, 22\. September$/ })
				.getByText('ganztägig', { exact: true }),
		).toBeVisible();
		await page.getByRole('button', { name: 'Termin bearbeiten: Alter Geburtstag' }).click();
		await expect(page.getByLabel('Beginn')).toHaveValue('2026-09-22');
		await expect(page.getByLabel('Ende (optional)')).toHaveValue('2026-09-22');
		await page.getByLabel('Titel').fill('Neuer Titel');
		await page.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect
			.poll(() => saved)
			.toMatchObject({
				title: 'Neuer Titel',
				startsAt: legacy.startsAt,
				endsAt: legacy.endsAt,
			});
	});

	for (const timezoneId of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
		test.describe(`agenda in ${timezoneId}`, () => {
			test.use({ timezoneId });
			test('today all-day event remains in the agenda after browsing a future month', async ({
				page,
			}) => {
				await page.clock.setFixedTime(
					new Date(
						timezoneId === 'Pacific/Kiritimati' ? '2026-09-21T22:00:00Z' : '2026-09-22T19:00:00Z',
					),
				);
				await setupMember(page);
				const event = {
					id: 'today-date',
					title: 'Heute ganztägig',
					description: null,
					startsAt: '2026-09-22T00:00:00.000Z',
					endsAt: null,
					allDay: true,
					location: null,
					recurrence: null,
				};
				const finalDay = {
					...event,
					id: 'final-date',
					title: 'Letzter Agendatag',
					startsAt: '2026-10-22T00:00:00.000Z',
				};
				await page.route(`**/api/wg/${SHARE_CODE}/events*`, (route) => {
					const query = new URL(route.request().url()).searchParams;
					const events = [event, finalDay].filter(
						(row) =>
							Date.parse(row.startsAt) >= Date.parse(query.get('from') ?? '') &&
							Date.parse(row.startsAt) <= Date.parse(query.get('to') ?? ''),
					);
					return route.fulfill({ json: { events } });
				});
				await navigateToFeature(page, `/wg/${SHARE_CODE}/kalender`);
				await expect(page.getByText(event.title, { exact: true })).toBeVisible();
				await expect(page.getByText(finalDay.title, { exact: true })).toBeVisible();
				await page.getByRole('tab', { name: 'Monat', exact: true }).click();
				const loaded = page.waitForResponse((response) => response.url().includes('/events?'));
				await page.getByRole('button', { name: 'Nächster Monat', exact: true }).click();
				await loaded;
				await page.getByRole('tab', { name: 'Agenda', exact: true }).click();
				await expect(page.getByText(event.title, { exact: true })).toBeVisible();
				await expect(
					page
						.getByRole('list', { name: /Dienstag, 22\. September$/ })
						.getByText('ganztägig', { exact: true }),
				).toBeVisible();
			});
		});
	}
});
