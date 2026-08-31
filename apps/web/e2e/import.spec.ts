import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const ENCODED = encodeURIComponent(FIXTURE_WG.shareCode);

const SPLITWISE_CSV = [
	'Date,Description,Cost,Currency,Category,paidBy,Sam,dsaf',
	'2026-05-10,Pizza,12.00,EUR,Food,Sam,6.00,6.00',
].join('\n');

test.describe('Import happy path', () => {
	test.setTimeout(180_000);

	test('walks through Splitwise CSV preview and commit, then sees the expense', async ({
		page,
	}) => {
		await setupMember(page);

		const insertedExpense = {
			id: 'exp-imported-1',
			paidByMemberId: FIXTURE_WG.memberId,
			occurredAt: '2026-05-10T12:00:00.000Z',
			description: 'Pizza',
			amountCents: 1200,
			splits: [
				{
					id: 'split-1',
					debtorMemberId: FIXTURE_WG.memberId,
					amountCents: 1200,
					settledAt: null,
				},
			],
			createdAt: new Date().toISOString(),
		};

		let committed = false;

		await page.route(`**/api/wg/${ENCODED}/imports/preview`, async (route) => {
			if (route.request().method() !== 'POST') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					parsed: [
						{
							date: '2026-05-10',
							description: 'Pizza',
							amountCents: 1200,
							paidByName: 'dsaf',
							splits: [{ memberName: 'dsaf', amountCents: 1200 }],
							warnings: [],
						},
					],
					memberMapping: { dsaf: FIXTURE_WG.memberId },
					conflicts: [],
					members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName }],
				}),
			});
		});

		await page.route(`**/api/wg/${ENCODED}/imports/commit`, async (route) => {
			if (route.request().method() !== 'POST') return route.fallback();
			committed = true;
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					importId: 'imp-1',
					inserted: 1,
					skipped: 0,
					errors: [],
				}),
			});
		});

		await page.route(`**/api/wg/${ENCODED}/expenses`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: committed ? [insertedExpense] : [],
				}),
			});
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/import`);
		await dismissOnboarding(page);

		await expect(page.getByRole('heading', { name: 'Ausgaben importieren' })).toBeVisible({
			timeout: 30_000,
		});

		// Step 1: pick Splitwise CSV.
		await page.getByRole('button', { name: 'Splitwise CSV' }).click();

		// Step 2: paste CSV.
		const csvArea = page.getByLabel('CSV-Inhalt');
		await expect(csvArea).toBeVisible({ timeout: 10_000 });
		await csvArea.fill(SPLITWISE_CSV);
		await page.getByRole('button', { name: 'Vorschau erstellen' }).click();

		// Step 3: mapping step renders (already auto-mapped, so just go forward).
		await expect(page.getByRole('heading', { name: 'Namen WG-Mitgliedern zuordnen' })).toBeVisible({
			timeout: 10_000,
		});
		await page.getByRole('button', { name: 'Weiter zur Vorschau' }).click();

		// Step 4: preview table; commit.
		await expect(page.getByRole('heading', { name: 'Vorschau' })).toBeVisible({
			timeout: 10_000,
		});
		// Exact, because the row's first cell carries a describing aria-label
		// ("Eintrag Pizza vom …") that a substring match would also hit.
		await expect(page.getByRole('cell', { name: 'Pizza', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Importieren' }).click();

		// Step 5: success — link to Ausgaben.
		const toExpenses = page.getByRole('link', { name: 'Zu den Ausgaben' });
		await expect(toExpenses).toBeVisible({ timeout: 15_000 });
		await toExpenses.click();

		// Verify the imported expense appears.
		await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}/ausgaben`), {
			timeout: 15_000,
		});
		const enteredExpenses = page.locator('details').filter({ hasText: 'Eingetragene Ausgaben' });
		await enteredExpenses.locator('summary').click();
		await expect(enteredExpenses.getByText('Pizza', { exact: true }).first()).toBeVisible({
			timeout: 15_000,
		});
	});
});
