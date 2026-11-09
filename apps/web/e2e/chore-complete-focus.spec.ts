// Keyboard focus after completing a chore from the cleaning rota.

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

async function openRotaWithDueChore(page: Page, overdueDays = 0): Promise<void> {
	const row = {
		id: 'focus-chore',
		title: 'Bad putzen',
		intervalDays: 7,
		recurrenceType: 'days',
		nextDueAt: new Date(Date.now() - overdueDays * 86_400_000).toISOString(),
		assignedMemberId: FIXTURE_WG.memberId,
		lastCompletedAt: null,
		lastCompletedByName: null,
		openGapCountForAssignee: 0,
		updatedAt: '2026-10-01T08:00:00.000Z',
	};
	const next = {
		...row,
		nextDueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
		updatedAt: '2026-10-01T09:00:00.000Z',
	};
	let completed = false;
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
	await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
		route.fulfill({ json: { chores: [completed ? next : row], monthCompletions: {} } }),
	);
	await page.route(`**/api/wg/${shareCode}/chores/${row.id}/complete`, (route) => {
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
	await mockUnreadCount(page, `/api/wg/${shareCode}`);
	await navigateToFeature(page, `/wg/${shareCode}/chores`);
	await dismissOnboarding(page);
}

test.describe('chore complete focus', () => {
	skipUnlessFixtures();
	test.use({ viewport: { width: 390, height: 844 } });

	test('keyboard focus stays inside the page after a one-tap completion', async ({ page }) => {
		await openRotaWithDueChore(page);
		const trigger = page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' });
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		// The toast takes focus for keyboard users, so the Undo is one key away.
		const undo = page.getByRole('button', { name: 'Rückgängig' });
		await expect(undo).toBeFocused();
		// Once it is gone, focus returns into the page instead of falling to the body.
		await page.getByRole('button', { name: 'Benachrichtigung schließen' }).click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						document.activeElement !== document.body &&
						Boolean(document.activeElement?.closest('main')),
				),
			)
			.toBe(true);
	});

	test('cancelling the catch-up confirmation returns focus to the complete button', async ({
		page,
	}) => {
		await openRotaWithDueChore(page, 3);
		const trigger = page.getByRole('button', { name: 'Aufgabe nachholen: Bad putzen' });
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(
			page.getByRole('button', { name: 'Nachholen bestätigen: Bad putzen' }),
		).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(trigger).toBeFocused();
	});
});
