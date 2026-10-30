// Editing an existing chore from the cleaning rota actions drawer.

import { expect, test } from '@playwright/test';
import { berlinDayKey } from '../src/core/utils/berlin-day';
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
		await navigateToFeature(page, `/wg/${shareCode}/chores`);
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

test.describe('chore submission feedback', () => {
	skipUnlessFixtures();

	for (const kind of ['task', 'absence'] as const) {
		test(`${kind} exposes its saving state until a failed request can be retried`, async ({
			page,
		}) => {
			await setupMember(page);
			const response = Promise.withResolvers<void>();
			const endpoint = kind === 'task' ? 'chores' : 'absences';
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/${endpoint}`, async (route) => {
				if (route.request().method() !== 'POST') return route.fallback();
				await response.promise;
				await route.fulfill({ status: 503, json: { error: 'unexpected_error' } });
			});
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/chores`);
			await dismissOnboarding(page);

			if (kind === 'task') {
				await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
				await page.getByLabel('Aufgabe', { exact: true }).fill('Bad putzen');
			} else {
				await page.getByRole('button', { name: 'Abwesenheit eintragen' }).click();
				const day = berlinDayKey(new Date());
				await page.getByLabel('Abwesenheit von', { exact: true }).fill(day);
				await page.getByLabel('Abwesenheit bis', { exact: true }).fill(day);
			}

			const save = page.getByRole('button', {
				name: kind === 'task' ? 'Aufgabe speichern' : 'Abwesenheit speichern',
				exact: true,
			});
			try {
				await save.click();
				const saving = page.getByRole('button', { name: 'Speichert…', exact: true });
				await expect(saving).toBeDisabled();
				await expect(saving).toHaveAttribute('aria-busy', 'true');
			} finally {
				response.resolve();
			}
			await expect(save).toBeEnabled();
			await expect(save).toHaveAttribute('aria-busy', 'false');
		});
	}
});
