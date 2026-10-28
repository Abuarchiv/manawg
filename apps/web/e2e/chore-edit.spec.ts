// Editing an existing chore from the Putzplan actions drawer.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('chore edit', () => {
	skipUnlessFixtures();

	test('sends only the changed fields with the listed version', async ({ page }) => {
		const shareCode = FIXTURE_WG.shareCode;
		const viewer = { id: FIXTURE_WG.memberId, name: 'Abu', color: null, active: true };
		const row = {
			id: 'edit-me',
			title: 'Aufgabe edit-me',
			intervalDays: 7,
			recurrenceType: 'days',
			nextDueAt: new Date(Date.now() + 3_600_000).toISOString(),
			assignedMemberId: viewer.id,
			lastCompletedAt: null,
			lastCompletedByName: null,
			openGapCountForAssignee: 0,
			updatedAt: '2026-10-01T08:00:00.123Z',
		};
		let patchBody: unknown = null;
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({ json: { members: [viewer], viewerIsAdmin: false } }),
		);
		await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
			route.fulfill({ json: { chores: [row], monthCompletions: {} } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences`, (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/chores/edit-me`, (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			patchBody = route.request().postDataJSON();
			return route.fulfill({ json: { chore: { ...row, title: 'Bad gründlich putzen' } } });
		});
		await mockUnreadCount(page, `/api/wg/${shareCode}`);
		await navigateToFeature(page, `/wg/${shareCode}/putzen`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Aufgabenaktionen: Aufgabe edit-me' }).click();
		await page.getByRole('button', { name: 'Aufgabe bearbeiten: Aufgabe edit-me' }).click();
		await page.getByLabel('Aufgabe', { exact: true }).fill('Bad gründlich putzen');
		await page.getByRole('button', { name: 'Speichern' }).click();

		await expect
			.poll(() => patchBody)
			.toEqual({ title: 'Bad gründlich putzen', expectedUpdatedAt: row.updatedAt });
	});
});
