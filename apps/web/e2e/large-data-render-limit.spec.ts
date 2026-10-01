import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

const TOTAL = 500;

test('ausgaben renders only a page of 500 expenses and loads more on demand', async ({ page }) => {
	const { memberId, memberName, shareCode } = FIXTURE_WG;
	await setupMember(page);
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
				expenses: Array.from({ length: TOTAL }, (_, i) => {
					const at = new Date(Date.UTC(2026, 8, 24) - i * 36 * 3600_000).toISOString();
					return {
						id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
						paidByMemberId: memberId,
						amountCents: 1000 + i,
						currency: 'EUR',
						description: `Ausgabe ${i}`,
						imageUrl: null,
						occurredAt: at,
						createdAt: at,
						updatedAt: at,
						splits: [],
					};
				}),
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

	const rows = page.locator('li[id^="expense-"]');
	await expect(rows.first()).toBeVisible();
	await expect(rows).toHaveCount(60);
	await page.getByRole('button', { name: /Mehr anzeigen \(440\)/ }).click();
	await expect(rows).toHaveCount(120);
});
