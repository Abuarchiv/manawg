// The expense form's date: sent only when changed, and never silently dropped offline.

import { expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
} from './_helpers';

test.describe('expense date', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const { memberId, memberName, shareCode } = FIXTURE_WG;
	const saved = {
		id: '11111111-2222-4333-8444-555555555555',
		paidByMemberId: memberId,
		amountCents: 1200,
		currency: 'EUR',
		description: 'Klopapier',
		imageUrl: null,
		occurredAt: '2026-01-15T11:00:00.000Z',
		createdAt: '2026-01-15T11:00:00.000Z',
		updatedAt: '2026-01-15T11:00:00.000Z',
		splits: [{ id: 's1', debtorMemberId: memberId, amountCents: 1200, settledAt: null }],
	};

	async function openForm(
		page: import('@playwright/test').Page,
		onPost: (route: import('@playwright/test').Route) => Promise<void> | void,
	) {
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [{ id: memberId, name: memberName, color: null, active: true }],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses**`, (route) =>
			route.request().method() === 'POST'
				? onPost(route)
				: route.fulfill({ json: { expenses: [], payments: [] } }),
		);
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
		await page.getByLabel('Beschreibung').fill('Klopapier');
		await page.getByLabel('Betrag').fill('12,00');
	}

	test('a back-dated expense sends the chosen day as noon Berlin time', async ({ page }) => {
		let body: Record<string, unknown> | null = null;
		await openForm(page, (route) => {
			body = route.request().postDataJSON();
			return route.fulfill({ json: { expense: saved, warning: null } });
		});
		await page.getByLabel('Datum').fill('2026-01-15');
		await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();

		await expect.poll(() => body?.occurredAt).toBe('2026-01-15T11:00:00.000Z');
	});

	test('an untouched date sends no occurredAt', async ({ page }) => {
		let body: Record<string, unknown> | null = null;
		await openForm(page, (route) => {
			body = route.request().postDataJSON();
			return route.fulfill({ json: { expense: saved, warning: null } });
		});
		await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();

		await expect.poll(() => body).not.toBeNull();
		expect(body).not.toHaveProperty('occurredAt');
	});

	test('a changed date is queued offline with its date', async ({ page }) => {
		await openForm(page, (route) => route.abort('connectionfailed'));
		await page.getByLabel('Datum').fill('2026-01-15');
		await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();

		await expect
			.poll(() =>
				page.evaluate(() => {
					const queue = JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]');
					return queue[0]?.payload?.occurredAt ?? null;
				}),
			)
			.toBe('2026-01-15T11:00:00.000Z');
	});
});
