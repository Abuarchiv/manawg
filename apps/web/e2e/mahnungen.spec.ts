import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const ENCODED = encodeURIComponent(FIXTURE_WG.shareCode);
const SECOND_MEMBER_ID = '11111111-2222-4333-8444-555555555555';

interface ExpenseDto {
	id: string;
	paidByMemberId: string;
	occurredAt: string;
	splits: Array<{
		id: string;
		debtorMemberId: string;
		amountCents: number;
		settledAt: string | null;
	}>;
}

async function stubMembers(page: import('@playwright/test').Page): Promise<void> {
	await page.route(`**/api/wg/${ENCODED}/members`, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				members: [
					{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: '#6d5efc' },
					{ id: SECOND_MEMBER_ID, name: 'Sam', color: '#0ea5e9' },
				],
			}),
		});
	});
}

test.describe('Mahnungen happy path', () => {
	test.setTimeout(180_000);

	test('shows empty-state when there are no open debts', async ({ page }) => {
		await setupMember(page);
		await stubMembers(page);

		await page.route(`**/api/wg/${ENCODED}/expenses`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route(`**/api/wg/${ENCODED}/reminders`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ reminders: [] }),
			});
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/mahnungen`);
		await dismissOnboarding(page);

		await expect(page.getByRole('heading', { name: 'Mahnungen', exact: true })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText('Alles ausgeglichen — nichts zu mahnen.')).toBeVisible({
			timeout: 10_000,
		});
		// "Mahnen" buttons should not exist in the empty state.
		await expect(page.getByRole('button', { name: /Mahnung senden/ })).toHaveCount(0);
	});

	test('enables the Mahnen button when a debt exists between members', async ({ page }) => {
		await setupMember(page);
		await stubMembers(page);

		const seededExpense: ExpenseDto = {
			id: 'exp-1',
			// Sam paid; the current member owes them.
			paidByMemberId: SECOND_MEMBER_ID,
			occurredAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
			splits: [
				{
					id: 'split-1',
					debtorMemberId: FIXTURE_WG.memberId,
					amountCents: 2000,
					settledAt: null,
				},
			],
		};

		await page.route(`**/api/wg/${ENCODED}/expenses`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [seededExpense] }),
			});
		});
		await page.route(`**/api/wg/${ENCODED}/reminders`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ reminders: [] }),
			});
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/mahnungen`);
		await dismissOnboarding(page);

		await expect(page.getByRole('heading', { name: 'Mahnungen', exact: true })).toBeVisible({
			timeout: 30_000,
		});

		// The debt row should render with both names visible.
		await expect(page.getByText(/Sam/i)).toBeVisible({ timeout: 10_000 });

		// The Mahnen button exposes its label via aria-label "Mahnung senden — Mahnen".
		const remindButton = page.getByRole('button', { name: /Mahnung senden/ });
		await expect(remindButton).toBeVisible({ timeout: 10_000 });
		await expect(remindButton).toBeEnabled();
	});
});
