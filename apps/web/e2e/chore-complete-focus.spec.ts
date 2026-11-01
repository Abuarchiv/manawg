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

async function openRotaWithDueChore(page: Page): Promise<void> {
	const row = {
		id: 'focus-chore',
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
		return route.fulfill({ json: { chore: next } });
	});
	await mockUnreadCount(page, `/api/wg/${shareCode}`);
	await navigateToFeature(page, `/wg/${shareCode}/chores`);
	await dismissOnboarding(page);
}

test.describe('chore complete focus', () => {
	skipUnlessFixtures();
	test.use({ viewport: { width: 390, height: 844 } });

	test('keyboard focus stays inside the page after the completion is confirmed', async ({
		page,
	}) => {
		await openRotaWithDueChore(page);
		const trigger = page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' });
		await trigger.focus();
		await page.keyboard.press('Enter');
		const confirm = page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' });
		await expect(confirm).toBeVisible();
		await confirm.focus();
		await page.keyboard.press('Enter');
		await expect(confirm).toBeHidden();
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

	test('cancelling the confirmation returns focus to the complete button', async ({ page }) => {
		await openRotaWithDueChore(page);
		const trigger = page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' });
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(
			page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' }),
		).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(trigger).toBeFocused();
	});
});
