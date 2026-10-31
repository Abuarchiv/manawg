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

	test('an edit after completion uses the confirmed version while the refresh is pending', async ({
		page,
	}) => {
		const shareCode = FIXTURE_WG.shareCode;
		const row = {
			id: 'complete-then-edit',
			title: 'Bad putzen',
			intervalDays: 7,
			recurrenceType: 'days',
			nextDueAt: new Date().toISOString(),
			assignedMemberId: FIXTURE_WG.memberId,
			lastCompletedAt: null,
			lastCompletedByName: null,
			openGapCountForAssignee: 0,
			updatedAt: '2026-10-01T08:00:00.000Z',
		};
		const next = {
			...row,
			title: 'Bad gemeinsam putzen',
			intervalDays: 14,
			nextDueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
			updatedAt: '2026-10-01T09:00:00.000Z',
		};
		let completed = false;
		let patchBody: Record<string, unknown> | null = null;
		let releaseRefresh: () => void = () => {};
		let refreshStarted: () => void = () => {};
		const refreshGate = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});
		const refreshing = new Promise<void>((resolve) => {
			refreshStarted = resolve;
		});
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
					],
					viewerIsAdmin: true,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/absences`, (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/chores`, async (route) => {
			if (completed) {
				refreshStarted();
				await refreshGate;
			}
			return route.fulfill({ json: { chores: [completed ? next : row], monthCompletions: {} } });
		});
		await page.route(`**/api/wg/${shareCode}/chores/${row.id}/complete`, (route) => {
			completed = true;
			return route.fulfill({ json: { chore: next } });
		});
		await page.route(`**/api/wg/${shareCode}/chores/${row.id}`, (route) => {
			patchBody = route.request().postDataJSON();
			return patchBody?.expectedUpdatedAt === next.updatedAt
				? route.fulfill({ json: { chore: { ...next, title: 'Bad gründlich putzen' } } })
				: route.fulfill({ status: 409, json: { error: 'chore_changed' } });
		});
		await mockUnreadCount(page, `/api/wg/${shareCode}`);
		await navigateToFeature(page, `/wg/${shareCode}/chores`);
		await dismissOnboarding(page);
		try {
			await page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }).click();
			await page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' }).click();
			await refreshing;
			await page.getByRole('button', { name: `Aufgabenaktionen: ${next.title}` }).click();
			await page.getByRole('button', { name: `Aufgabe bearbeiten: ${next.title}` }).click();
			await expect(page.getByLabel('Aufgabe', { exact: true })).toHaveValue(next.title);
			await expect(page.getByRole('button', { name: 'alle 14 T.', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true',
			);
			await page.getByLabel('Aufgabe', { exact: true }).fill('Bad gründlich putzen');
			await page.getByRole('button', { name: 'Speichern' }).click();
			await expect
				.poll(() => patchBody)
				.toEqual({ title: 'Bad gründlich putzen', expectedUpdatedAt: next.updatedAt });
		} finally {
			releaseRefresh();
		}
	});

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
