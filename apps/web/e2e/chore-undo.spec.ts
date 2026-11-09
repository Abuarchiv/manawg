// One-tap completion of a chore and the Undo toast, on the cleaning rota and on the start page.

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const shareCode = FIXTURE_WG.shareCode;
const BASE = `/api/wg/${shareCode}`;
const DAY_MS = 86_400_000;

const row = {
	id: 'undo-chore',
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
	nextDueAt: new Date(Date.now() + 7 * DAY_MS).toISOString(),
	updatedAt: '2026-10-01T09:00:00.000Z',
};

/** The rota with a mocked complete route and a mocked undo route that answers `undoStatus`. */
async function openRota(page: Page, undoStatus: number): Promise<{ undoBodies: unknown[] }> {
	const undoBodies: unknown[] = [];
	let completed = false;
	await setupMember(page);
	await page.route(`**${BASE}/members`, (route) =>
		route.fulfill({
			json: {
				members: [
					{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
				],
				viewerIsAdmin: true,
			},
		}),
	);
	await page.route(`**${BASE}/absences`, (route) => route.fulfill({ json: { absences: [] } }));
	await page.route(`**${BASE}/chores`, (route) =>
		route.fulfill({ json: { chores: [completed ? next : row], monthCompletions: {} } }),
	);
	await page.route(`**${BASE}/chores/${row.id}/complete`, (route) => {
		completed = true;
		return route.fulfill({
			json: {
				chore: next,
				completion: {
					id: '11111111-1111-4111-8111-111111111111',
					previous: {
						nextDueAt: row.nextDueAt,
						assignedMemberId: row.assignedMemberId,
						anchorAt: row.nextDueAt,
					},
				},
			},
		});
	});
	await page.route(`**${BASE}/chores/${row.id}/complete/undo`, (route) => {
		undoBodies.push(route.request().postDataJSON());
		if (undoStatus === 200) completed = false;
		return route.fulfill(
			undoStatus === 200
				? { json: { chore: row } }
				: { status: undoStatus, json: { error: 'chore_changed' } },
		);
	});
	await mockUnreadCount(page, BASE);
	await navigateToFeature(page, `/wg/${shareCode}/chores`);
	await dismissOnboarding(page);
	return { undoBodies };
}

test.describe('chore completion with undo', () => {
	skipUnlessFixtures();
	test.use({ viewport: { width: 390, height: 844 } });

	test('one tap completes and Undo brings the task back', async ({ page }) => {
		const { undoBodies } = await openRota(page, 200);
		const complete = page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' });
		const choreRow = page.locator(`#chore-${row.id}`);
		await expect(choreRow).toContainText('heute fällig');
		await complete.click();

		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expect(page.getByText(/Bad putzen erledigt\./)).toBeVisible();
		await expect(choreRow).toContainText('in 7 T.');

		await page.getByRole('button', { name: 'Rückgängig' }).click();
		await expect(page.getByText('Bad putzen ist wieder offen.')).toBeVisible();
		await expect(choreRow).toContainText('heute fällig');
		expect(undoBodies).toEqual([
			{
				completionId: '11111111-1111-4111-8111-111111111111',
				previous: {
					nextDueAt: row.nextDueAt,
					assignedMemberId: FIXTURE_WG.memberId,
					anchorAt: row.nextDueAt,
				},
				expectedNextDueAt: next.nextDueAt,
				expectedAssignedMemberId: FIXTURE_WG.memberId,
			},
		]);
	});

	test('an undo that finds the task changed says so and keeps it done', async ({ page }) => {
		await openRota(page, 409);
		await page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }).click();
		await page.getByRole('button', { name: 'Rückgängig' }).click();
		await expect(
			page.getByText('Wurde schon geändert, Rückgängig nicht mehr möglich'),
		).toBeVisible();
		await expect(page.locator(`#chore-${row.id}`)).toContainText('in 7 T.');
	});

	test('the Undo toast outlasts the default toast time', async ({ page }) => {
		await openRota(page, 200);
		await page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }).click();
		const undo = page.getByRole('button', { name: 'Rückgängig' });
		await expect(undo).toBeVisible();
		await page.waitForTimeout(5000);
		await expect(undo).toBeVisible();
	});
});
