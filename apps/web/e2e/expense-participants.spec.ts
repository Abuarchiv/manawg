// Dropping a member from an equal split.

import { expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
} from './_helpers';

test.describe('expense participants', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const { memberId, memberName, shareCode } = FIXTURE_WG;
	const other = {
		id: '22222222-3333-4444-8555-666666666666',
		name: 'Mara',
		color: null,
		active: true,
	};

	test('unchecking a member splits the amount among the rest as manual shares', async ({
		page,
	}) => {
		let body: { splits?: Array<{ debtorMemberId: string; amountCents: number }> } | null = null;
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [{ id: memberId, name: memberName, color: null, active: true }, other],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses**`, (route) => {
			if (route.request().method() !== 'POST') {
				return route.fulfill({ json: { expenses: [], payments: [] } });
			}
			body = route.request().postDataJSON();
			return route.fulfill({
				status: 500,
				json: { error: 'server_error' },
			});
		});
		await page.route(`**/api/wg/${shareCode}/recurring-expenses*`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);
		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Ausgabe hinzufügen' }).first().click();
		await page.getByLabel('Beschreibung').fill('Pizza');

		await page.getByText('Nicht alle beteiligt?').click();
		await page.getByRole('checkbox', { name: 'Mara' }).click();
		await expect(
			page.getByText('Gib zuerst den Betrag ein, dann kannst du Personen herausnehmen.'),
		).toBeVisible();

		await page.getByLabel('Betrag').fill('10,00');
		await page.getByRole('checkbox', { name: 'Mara' }).click();
		await expect(page.getByLabel('Aufteilung: Manuell')).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();

		await expect
			.poll(() => body?.splits)
			.toEqual([{ debtorMemberId: memberId, amountCents: 1000 }]);
	});
});
