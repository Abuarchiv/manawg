// Chores: absence cache and week status.
// Why: Cache and retry paths must not resurrect removed state.

import { expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('chore absence cache', () => {
	skipUnlessFixtures();

	test('a removed absence stays removed when a chore completion updates the cache', async ({
		page,
	}) => {
		const shareCode = FIXTURE_WG.shareCode;
		const memberId = FIXTURE_WG.memberId;
		const absence = {
			id: 'absence-holiday',
			memberId,
			memberName: 'Alex',
			startDate: '2026-01-01T00:00:00.000Z',
			endDate: '2099-12-31T00:00:00.000Z',
			reason: 'Urlaub',
		};
		let absences = [absence];
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
			route.fulfill({
				json: {
					chores: [
						{
							id: 'chore-bath',
							title: 'Bad putzen',
							intervalDays: 7,
							recurrenceType: 'days',
							nextDueAt: new Date().toISOString(),
							assignedMemberId: memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
					],
					monthCompletions: {},
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/absences`, (route) =>
			route.fulfill({ json: { absences } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences/${absence.id}`, (route) => {
			absences = [];
			return route.fulfill({ json: {} });
		});
		await page.route(`**/api/wg/${shareCode}/chores/chore-bath/complete`, (route) =>
			route.fulfill({ status: 503, json: { error: 'server_error' } }),
		);

		await navigateToFeature(page, `/wg/${shareCode}/putzen`);
		await dismissOnboarding(page);
		const absenceRow = page.locator(`#absence-${absence.id}`);
		await absenceRow.getByRole('button', { name: /entfernen$/ }).click();
		await absenceRow.getByRole('button', { name: /endgültig entfernen$/ }).click();
		await expect(absenceRow).toHaveCount(0);

		await page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }).click();
		await page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' }).click();
		await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText(
			'Erledigt-Aktion konnte nicht gespeichert werden',
		);
		await expect(absenceRow).toHaveCount(0);
	});

	test('an armed absence removal can be cancelled without deleting it', async ({ page }) => {
		const shareCode = FIXTURE_WG.shareCode;
		const memberId = FIXTURE_WG.memberId;
		const absence = {
			id: 'absence-holiday',
			memberId,
			memberName: 'Alex',
			startDate: '2026-01-01T00:00:00.000Z',
			endDate: '2099-12-31T00:00:00.000Z',
			reason: 'Urlaub',
		};
		let deleteCalls = 0;
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
			route.fulfill({ json: { chores: [], monthCompletions: {} } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences`, (route) =>
			route.fulfill({ json: { absences: [absence] } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences/${absence.id}`, (route) => {
			deleteCalls += 1;
			return route.fulfill({ json: {} });
		});

		await navigateToFeature(page, `/wg/${shareCode}/putzen`);
		await dismissOnboarding(page);
		const absenceRow = page.locator(`#absence-${absence.id}`);
		await absenceRow.getByRole('button', { name: /entfernen$/ }).click();
		await expect(absenceRow.getByRole('button', { name: /endgültig entfernen$/ })).toBeVisible();
		await absenceRow.getByRole('button', { name: /abbrechen$/ }).click();

		await expect(absenceRow.getByRole('button', { name: /endgültig entfernen$/ })).toHaveCount(0);
		await expect(absenceRow).toBeVisible();
		expect(deleteCalls).toBe(0);
	});

	test('an absence removal stays pending until the server answers and is retryable after a failure', async ({
		page,
	}) => {
		const shareCode = FIXTURE_WG.shareCode;
		const absence = {
			id: 'absence-holiday',
			memberId: FIXTURE_WG.memberId,
			memberName: 'Alex',
			startDate: '2026-01-01T00:00:00.000Z',
			endDate: '2099-12-31T00:00:00.000Z',
			reason: 'Urlaub',
		};
		let deleteCalls = 0;
		let releaseFirstDelete: () => void = () => {};
		const firstDeleteGate = new Promise<void>((resolve) => {
			releaseFirstDelete = resolve;
		});
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
			route.fulfill({ json: { chores: [], monthCompletions: {} } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences`, (route) =>
			route.fulfill({ json: { absences: deleteCalls > 1 ? [] : [absence] } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences/${absence.id}`, async (route) => {
			deleteCalls += 1;
			if (deleteCalls === 1) {
				await firstDeleteGate;
				return route.fulfill({ status: 500, json: { error: 'server_error' } });
			}
			return route.fulfill({ json: {} });
		});

		await navigateToFeature(page, `/wg/${shareCode}/putzen`);
		await dismissOnboarding(page);
		const absenceRow = page.locator(`#absence-${absence.id}`);
		const remove = absenceRow.getByRole('button', { name: /entfernen$/ });
		await remove.click();
		await remove.click();
		await expect(remove).toBeDisabled();
		releaseFirstDelete();

		await expect(page.getByText('Abwesenheit konnte nicht entfernt werden.')).toBeVisible();
		await expect(remove).toBeEnabled();
		expect(deleteCalls).toBe(1);
		await remove.click();
		await remove.click();
		await expect(absenceRow).toHaveCount(0);
		expect(deleteCalls).toBe(2);
	});
});

test.describe('week status', () => {
	const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;

	test('does not claim chores stayed visible when they also failed to load', async ({ page }) => {
		await setupMember(page);
		await page.route(`**${BASE}/dashboard`, (route) =>
			route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } }),
		);
		await page.route(`**${BASE}/events**`, (route) =>
			route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } }),
		);
		await mockUnreadCount(page, BASE);
		await page.route(`**${BASE}/activity`, (route) =>
			route.fulfill({ status: 200, json: { items: [], reminders: [] } }),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);

		await expect(
			page.getByText('Termine konnten nicht geladen werden.', { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText('Putzplan-Aufgaben bleiben sichtbar', { exact: false }),
		).toHaveCount(0);
	});
});
