// Expense details: the "edited" note.
// Why: A debtor who got a push about a changed expense must see in the row that it was edited,
// and an expense that was never edited must show no note.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { setEnglishLocale } from './support/i18n';

const { shareCode, memberId, memberName } = FIXTURE_WG;
const EDITED_ID = '9af0f27a-3d2b-4983-b5cb-3920f6d6e51f';
const FRESH_ID = '9af0f27a-3d2b-4983-b5cb-3920f6d6e520';

function expense(id: string, description: string, updatedAt: string) {
	return {
		id,
		paidByMemberId: memberId,
		amountCents: 4800,
		currency: 'EUR',
		description,
		category: 'groceries',
		imageUrl: null,
		occurredAt: '2026-09-24T17:00:00.000Z',
		createdAt: '2026-09-24T17:00:00.000Z',
		updatedAt,
		splits: [{ id: `${id}-s0`, debtorMemberId: memberId, amountCents: 4800, settledAt: null }],
	};
}

test.describe('edited expenses', () => {
	skipUnlessFixtures();

	for (const locale of ['de', 'en'] as const) {
		test(`only an edited expense says so in ${locale}`, async ({ context, page, baseURL }) => {
			if (locale === 'en') await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
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
							expense(EDITED_ID, 'Wocheneinkauf', '2026-09-26T09:30:00.000Z'),
							// Stamped within the minute of creation: the write itself, not an edit.
							expense(FRESH_ID, 'Spülmittel', '2026-09-24T17:00:20.000Z'),
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
			await navigateToFeature(page, `/wg/${shareCode}/expenses`);
			await dismissOnboarding(page);

			const note = locale === 'de' ? /Bearbeitet am/ : /Edited/;
			const edited = page.locator(`#expense-${EDITED_ID}`);
			await edited.getByRole('button').first().click();
			await expect(edited.getByText(note)).toBeVisible();

			const fresh = page.locator(`#expense-${FRESH_ID}`);
			await fresh.getByRole('button').first().click();
			await expect(fresh.getByText(/Spülmittel/).first()).toBeVisible();
			await expect(fresh.getByText(note)).toHaveCount(0);
			await expect
				.poll(() =>
					page.evaluate(
						() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
					),
				)
				.toBe(true);
		});
	}
});
