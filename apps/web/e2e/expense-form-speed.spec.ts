// Expense form speed: amount first, category chips, focus on the amount, impact toast.
// Why: adding an expense is the daily action; a prefill from shopping should need an amount and Enter.

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

skipUnlessFixtures();

const { shareCode, memberId, memberName } = FIXTURE_WG;
const API = `/api/wg/${shareCode}`;
const MINA = { id: 'e2e-member-mina', name: 'Mina', color: null, active: true };
const NOW = new Date().toISOString();

function pastExpense(description: string, category: string) {
	return {
		id: `past-${description}`,
		paidByMemberId: memberId,
		amountCents: 500,
		currency: 'EUR',
		description,
		category,
		imageUrl: null,
		occurredAt: NOW,
		createdAt: NOW,
		updatedAt: NOW,
		splits: [
			{ id: `s-${description}`, debtorMemberId: memberId, amountCents: 500, settledAt: null },
		],
	};
}

async function mockWg(
	page: Page,
	expenses: unknown[],
): Promise<{ posts: Array<Record<string, unknown>> }> {
	const posts: Array<Record<string, unknown>> = [];
	await setupMember(page);
	await page.route(`**${API}/members`, (route) =>
		route.fulfill({
			json: {
				members: [{ id: memberId, name: memberName, color: null, active: true }, MINA],
				viewerIsAdmin: false,
			},
		}),
	);
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') {
			return route.fulfill({ json: { expenses, payments: [] } });
		}
		const body = route.request().postDataJSON() as Record<string, unknown>;
		posts.push(body);
		const splits = body.splits as Array<{ debtorMemberId: string; amountCents: number }>;
		return route.fulfill({
			json: {
				expense: {
					...body,
					id: 'created',
					currency: 'EUR',
					occurredAt: NOW,
					createdAt: NOW,
					updatedAt: NOW,
					splits: splits.map((split, index) => ({ ...split, id: `c${index}`, settledAt: null })),
				},
				warning: null,
			},
		});
	});
	await page.route(`**${API}/recurring-expenses`, (route) =>
		route.fulfill({ json: { recurringExpenses: [] } }),
	);
	await page.route(`**${API}/dashboard`, (route) =>
		route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
	);
	await mockUnreadCount(page, API);
	return { posts };
}

test('a shopping prefill opens on the amount; Enter saves and the toast names the impact', async ({
	page,
}) => {
	const { posts } = await mockWg(page, []);
	await page.route(`**${API}/shopping`, (route) =>
		route.fulfill({
			json: {
				items: [
					{
						id: 'bought-1',
						name: 'Hafermilch',
						quantity: null,
						addedByMemberId: memberId,
						boughtAt: NOW,
						boughtByMemberId: memberId,
						createdAt: NOW,
					},
				],
			},
		}),
	);
	await page.setViewportSize({ width: 390, height: 780 });
	await navigateToFeature(page, `/wg/${shareCode}/shopping`);
	await dismissOnboarding(page);
	await page.getByRole('link', { name: 'Ausgabe erfassen' }).first().click();

	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('Beschreibung', { exact: true })).toHaveValue(/Hafermilch/);
	await expect(dialog.getByRole('radio', { name: 'Lebensmittel' })).toBeChecked();
	const amount = dialog.getByLabel('Betrag', { exact: true });
	await expect(amount).toBeFocused();

	// Amount sits above the category, the category above the payer.
	const amountBox = await amount.boundingBox();
	const chipBox = await dialog
		.getByRole('radio', { name: 'Lebensmittel' })
		.locator('..')
		.boundingBox();
	expect(amountBox && chipBox && amountBox.y < chipBox.y).toBe(true);

	await amount.fill('9,60');
	await amount.press('Enter');
	await expect.poll(() => posts.length).toBe(1);
	expect(posts[0]).toMatchObject({ amountCents: 960, category: 'groceries' });
	// Equal split between two people: the other one owes half.
	await expect(
		page.getByText(
			/Gespeichert\. Du bekommst 4,80\s€ zurück \(Mina\)\. Bezahlt wird außerhalb der App\./,
		),
	).toBeVisible();
});

test('the category follows an earlier expense with the same description until one is picked', async ({
	page,
}) => {
	await mockWg(page, [pastExpense('Putzmittel', 'household')]);
	await page.setViewportSize({ width: 320, height: 640 });
	await navigateToFeature(page, `/wg/${shareCode}/expenses`);
	await dismissOnboarding(page);
	await page.getByRole('button', { name: 'Ausgabe hinzufügen' }).first().click();

	const dialog = page.getByRole('dialog');
	const description = dialog.getByLabel('Beschreibung', { exact: true });
	await expect(description).toBeFocused();
	await expect(dialog.getByRole('radio', { name: 'Sonstiges' })).toBeChecked();
	await description.fill('putzmittel ');
	await expect(dialog.getByRole('radio', { name: 'Haushalt' })).toBeChecked();

	// Enter in the description moves on to the amount instead of submitting.
	await description.press('Enter');
	await expect(dialog.getByLabel('Betrag', { exact: true })).toBeFocused();

	// Arrow keys move the single choice; a picked category is not replaced by the default.
	await dialog.getByRole('radio', { name: 'Haushalt' }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(dialog.getByRole('radio', { name: 'Wohnen & Nebenkosten' })).toBeChecked();
	await description.fill('Putzmittel 2');
	await description.fill('Putzmittel');
	await expect(dialog.getByRole('radio', { name: 'Wohnen & Nebenkosten' })).toBeChecked();
});

test('an unknown category in the link is ignored', async ({ page }) => {
	await mockWg(page, []);
	await navigateToFeature(page, `/wg/${shareCode}/expenses?new=1&desc=Test&category=rent`);
	await dismissOnboarding(page);
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('radio', { name: 'Sonstiges' })).toBeChecked();
	await expect(dialog.getByLabel('Betrag', { exact: true })).toBeFocused();
});

test('tapping the selected chip counts as a choice', async ({ page }) => {
	await mockWg(page, [pastExpense('Putzmittel', 'household')]);
	await navigateToFeature(page, `/wg/${shareCode}/expenses`);
	await dismissOnboarding(page);
	await page.getByRole('button', { name: 'Ausgabe hinzufügen' }).first().click();
	const dialog = page.getByRole('dialog');
	await dialog.locator('label', { hasText: 'Sonstiges' }).click();
	await dialog.getByLabel('Beschreibung', { exact: true }).fill('Putzmittel');
	await expect(dialog.getByRole('radio', { name: 'Sonstiges' })).toBeChecked();
});

test('a category hint in the link yields to an earlier expense with the same description', async ({
	page,
}) => {
	await mockWg(page, [pastExpense('Putzmittel', 'household')]);
	await navigateToFeature(
		page,
		`/wg/${shareCode}/expenses?new=1&desc=Putzmittel&categoryHint=groceries`,
	);
	await dismissOnboarding(page);
	await expect(page.getByRole('dialog').getByRole('radio', { name: 'Haushalt' })).toBeChecked();
});
