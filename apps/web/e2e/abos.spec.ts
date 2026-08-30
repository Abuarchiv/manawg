import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const ENCODED = encodeURIComponent(FIXTURE_WG.shareCode);

interface RecurringExpense {
	id: string;
	wgId: string;
	createdByMemberId: string;
	paidByMemberId: string;
	description: string;
	amountCents: number;
	intervalMonths: number;
	nextDueAt: string;
	lastCreatedAt: string | null;
	pausedAt: string | null;
	createdAt: string;
	splits: Array<{ debtorMemberId: string; amountCents: number }>;
}

function nextDueIso(daysAhead: number): string {
	const d = new Date();
	d.setHours(12, 0, 0, 0);
	d.setDate(d.getDate() + daysAhead);
	return d.toISOString();
}

function ymd(daysAhead: number): string {
	const d = new Date();
	d.setHours(12, 0, 0, 0);
	d.setDate(d.getDate() + daysAhead);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

test.describe('Abos happy path', () => {
	test.setTimeout(180_000);

	test('creates Netflix 15€ monthly and shows it with next-due date', async ({ page }) => {
		await setupMember(page);

		const expenses: RecurringExpense[] = [];

		await page.route(`**/api/wg/${ENCODED}/recurring-expenses`, async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ recurringExpenses: expenses }),
				});
				return;
			}
			if (request.method() === 'POST') {
				const payload = JSON.parse(request.postData() ?? '{}');
				const created: RecurringExpense = {
					id: `abo-${expenses.length + 1}`,
					wgId: FIXTURE_WG.id,
					createdByMemberId: FIXTURE_WG.memberId,
					paidByMemberId: payload.paidByMemberId,
					description: payload.description,
					amountCents: payload.amountCents,
					intervalMonths: payload.intervalMonths,
					nextDueAt: payload.nextDueAt,
					lastCreatedAt: null,
					pausedAt: null,
					createdAt: new Date().toISOString(),
					splits: payload.splits ?? [
						{ debtorMemberId: FIXTURE_WG.memberId, amountCents: payload.amountCents },
					],
				};
				expenses.push(created);
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ recurringExpense: created }),
				});
				return;
			}
			await route.fallback();
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/abos`);
		await dismissOnboarding(page);

		await expect(page.getByRole('heading', { name: 'Fixkosten' })).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Neues Abo' }).click();

		const description = page.locator('#abo-description');
		await expect(description).toBeVisible({ timeout: 10_000 });
		await description.fill('Netflix');
		await page.locator('#abo-amount').fill('15,00');
		// Intervall default is 1 Monat — keep monthly.
		const nextDate = ymd(14);
		await page.locator('#abo-next-due').fill(nextDate);

		await page.getByRole('button', { name: 'Abo anlegen' }).click();

		// Notice surfaces the success message; row appears with description + amount.
		await expect(page.getByText('Abo angelegt.')).toBeVisible({ timeout: 10_000 });

		const row = page.locator('li', { hasText: 'Netflix' }).first();
		await expect(row).toBeVisible({ timeout: 10_000 });
		// The amount appears in both the main header and the per-member split chip,
		// so first() avoids strict-mode violations.
		await expect(row.getByText('15,00').first()).toBeVisible();
		await expect(row.getByText(/nächste Fälligkeit:/)).toBeVisible();
		// Row carries the monthly interval label.
		await expect(row.getByText('monatlich')).toBeVisible();
		void nextDueIso;
	});
});
