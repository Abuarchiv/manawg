// Chores: next assignee/fairness, absence cache, retry, swap coordination and week status.
// Why: fair rotation and Berlin calendar-day maths regress silently without explicit cases.

import { type Locator, expect, test } from '@playwright/test';
import { buildDraftKey } from '../src/core/offline/drafts';
import * as offlineClient from '../src/core/offline/offline-client';
import { type ActivityItem, filterActivityByScope } from '../src/core/reads/activity';
import {
	buildChoreFairness,
	chooseNextAvailableMember,
} from '../src/features/chores/chore-fairness';
import { getChoreStatus } from '../src/features/chores/chore-status';
import { MEMBER_TOKEN_HEADER } from '../src/shared/lib/member-header';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
} from './_helpers';

test.describe('chore absence cache', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('a removed absence stays removed when a chore completion updates the cache', async ({
		page,
	}) => {
		const shareCode = 'MTE8PZAT';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
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
		const shareCode = 'MTE8PZAT';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
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
		const shareCode = 'MTE8PZAT';
		const absence = {
			id: 'absence-holiday',
			memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
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

test.describe('chore next assignee', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const SHARE_CODE = FIXTURE_WG.shareCode;
	const CURRENT_MEMBER = FIXTURE_WG.memberId;

	type FixtureMember = { id: string; name: string; color: string | null; active: boolean };
	type FixtureAbsence = {
		id: string;
		memberId: string;
		memberName: string;
		startDate: string;
		endDate: string;
		reason: string;
	};

	function chore(id: string, assignedMemberId: string) {
		return {
			id,
			title: `Aufgabe ${id}`,
			intervalDays: 7,
			recurrenceType: 'days',
			nextDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			assignedMemberId,
			lastCompletedAt: null,
			lastCompletedByName: null,
			openGapCountForAssignee: 0,
		};
	}

	function absence(member: FixtureMember): FixtureAbsence {
		return {
			id: `absence-${member.id}`,
			memberId: member.id,
			memberName: member.name,
			startDate: new Date(Date.now() - 86_400_000).toISOString(),
			// Rotation checks absences on the next due day (one interval ahead), so
			// the absence must cover the whole next round, not just today.
			endDate: new Date(Date.now() + 9 * 86_400_000).toISOString(),
			reason: 'Urlaub',
		};
	}

	async function openPutzen(
		page: import('@playwright/test').Page,
		members: FixtureMember[],
		chores: ReturnType<typeof chore>[],
		absences: FixtureAbsence[],
		viewerIsAdmin = false,
	) {
		await setupMember(page);
		const memberTokens: Array<string | undefined> = [];
		await page.route(`**/api/wg/${SHARE_CODE}/members`, (route) => {
			memberTokens.push(route.request().headers()[MEMBER_TOKEN_HEADER]);
			return route.fulfill({ json: { members, viewerIsAdmin } });
		});
		await page.route(`**/api/wg/${SHARE_CODE}/chores`, (route) =>
			route.fulfill({ json: { chores, monthCompletions: {} } }),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/absences`, (route) =>
			route.fulfill({ json: { absences } }),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/dashboard`, (route) =>
			route.fulfill({
				json: { openShoppingCount: 123, dueChores: [], dueRecurringExpenses: [] },
			}),
		);
		await mockUnreadCount(page, `/api/wg/${SHARE_CODE}`);
		await navigateToFeature(page, `/wg/${SHARE_CODE}/putzen`);
		await dismissOnboarding(page);
		await expect.poll(() => memberTokens.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
		expect(memberTokens.every((token) => token === 'fixture-member-token')).toBe(true);
		const household = page.getByRole('navigation', { name: 'Haushalt' });
		const shopping = household.getByRole('link', { name: 'Einkäufe, 123 offen' });
		await expect(shopping).toBeVisible();
		await expect(shopping).toHaveText('Einkäufe99+');
	}

	async function expectNoOverflow(container: Locator) {
		const hasOverflow = await container.evaluate(
			(element) =>
				element.scrollHeight > element.clientHeight + 1 ||
				element.scrollWidth > element.clientWidth + 1,
		);
		expect(hasOverflow).toBe(false);
	}

	test('keeps chore action buttons readable and reachable at phone widths and enlarged text', async ({
		page,
	}) => {
		test.setTimeout(60_000);
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const flatmate: FixtureMember = {
			id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
			name: 'Mina',
			color: null,
			active: true,
		};
		const title = 'Spülmaschinenreinigung mit Entkalkung und gründlicher Küchenhygiene';
		// Übernehmen gibt es nur bei Aufgaben anderer.
		const rows = [{ ...chore('actions-zoom', flatmate.id), title }];

		await openPutzen(page, [viewer, flatmate], rows, []);

		const row = page.locator('#chore-actions-zoom');
		const opener = row.getByRole('button', { name: `Aufgabenaktionen: ${title}` });
		const takeOver = page.getByRole('button', { name: 'Ich übernehme' });
		const swap = page.getByRole('button', { name: `Tausch auf der Pinnwand anfragen: ${title}` });
		const close = page.getByRole('button', { name: 'Schließen' });

		for (const theme of ['light', 'dark'] as const) {
			for (const width of [320, 360]) {
				for (const rootFontSize of [16, 32]) {
					await page.setViewportSize({ width, height: 800 });
					await page.emulateMedia({ colorScheme: theme });
					await page.evaluate((size) => {
						document.documentElement.style.fontSize = `${size}px`;
					}, rootFontSize);

					await opener.click();
					await expect(takeOver).toBeVisible();
					await expect(swap).toBeVisible();

					// Read both rectangles in one frame while the drawer animates.
					const boxes = await takeOver.or(swap).evaluateAll((buttons) =>
						buttons.map((button) => {
							const { y, height } = button.getBoundingClientRect();
							return { text: button.textContent?.replace(/\s+/g, ' ').trim(), y, height };
						}),
					);
					const takeOverBox = boxes.find((box) => box.text === 'Ich übernehme');
					const swapBox = boxes.find((box) => box.text === 'Tausch auf der Pinnwand anfragen');
					expect(takeOverBox).toBeDefined();
					expect(swapBox).toBeDefined();
					if (!takeOverBox || !swapBox) throw new Error('Chore action button is not rendered');
					expect(takeOverBox.height).toBeGreaterThanOrEqual(44);
					expect(swapBox.height).toBeGreaterThanOrEqual(44);
					expect(takeOverBox.y + takeOverBox.height).toBeLessThanOrEqual(swapBox.y + 1);

					for (const button of [takeOver, swap]) {
						await expectNoOverflow(button);
					}

					await takeOver.focus();
					await expect(takeOver).toBeFocused();
					await page.keyboard.press('Tab');
					await expect(swap).toBeFocused();
					if (width === 320 && rootFontSize === 32) {
						const scrollState = await swap.evaluate((button) => {
							const element = button
								.closest('[data-slot="drawer-content"]')
								?.querySelector('div.overflow-y-auto');
							if (!(element instanceof HTMLElement)) return null;
							const area = element.getBoundingClientRect();
							const visibleTop = area.top + element.clientTop;
							const visibleBottom = visibleTop + element.clientHeight;
							const buttonBounds = button.getBoundingClientRect();
							return {
								top: element.scrollTop,
								clientHeight: element.clientHeight,
								scrollHeight: element.scrollHeight,
								visibleHeight: Math.max(
									0,
									Math.min(buttonBounds.bottom, visibleBottom) -
										Math.max(buttonBounds.top, visibleTop),
								),
							};
						});
						expect(scrollState).not.toBeNull();
						if (!scrollState) throw new Error('Chore action scroll area is not rendered');
						if (scrollState.scrollHeight > scrollState.clientHeight) {
							expect(scrollState.top).toBeGreaterThan(0);
						}
						expect(scrollState.visibleHeight).toBeGreaterThanOrEqual(44);
					}
					await page.keyboard.press('Tab');
					await expect(close).toBeFocused();
					await page.keyboard.press('Escape');
					await expect(opener).toHaveAttribute('aria-expanded', 'false');
				}
			}
		}
	});

	test('keeps the admin remove action and confirmation readable at enlarged text', async ({
		page,
	}) => {
		test.setTimeout(60_000);
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const title = 'Spülmaschinenreinigung mit Entkalkung und gründlicher Küchenhygiene';
		const rows = [{ ...chore('actions-admin-zoom', viewer.id), title }];

		await openPutzen(page, [viewer], rows, [], true);
		await page.setViewportSize({ width: 320, height: 800 });
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.evaluate(() => {
			document.documentElement.style.fontSize = '32px';
		});

		const row = page.locator('#chore-actions-admin-zoom');
		await row.getByRole('button', { name: `Aufgabenaktionen: ${title}` }).click();

		const remove = page.getByRole('button', { name: `Aufgabe entfernen: ${title}` });
		await expect(remove).toBeVisible();
		const removeBox = await remove.boundingBox();
		expect(removeBox).not.toBeNull();
		if (!removeBox) throw new Error('Admin remove action is not rendered');
		expect(removeBox.height).toBeGreaterThanOrEqual(44);
		await expectNoOverflow(remove);

		await remove.click();
		// WCAG 4.1.3: this is a confirmation prompt, not an error — it is a polite
		// status message (role="alert" is reserved for errors).
		const alert = page
			.getByRole('status')
			.filter({ hasText: 'Diese Aufgabe endgültig entfernen?' });
		await expect(alert).toBeVisible();
		const confirmation = page.getByRole('button', {
			name: `Endgültig entfernen: ${title}`,
		});
		await expect(confirmation).toBeVisible();
		const alertBox = await alert.boundingBox();
		const confirmationBox = await confirmation.boundingBox();
		expect(alertBox).not.toBeNull();
		expect(confirmationBox).not.toBeNull();
		if (!alertBox || !confirmationBox) throw new Error('Admin confirmation is not rendered');
		expect(alertBox.y + alertBox.height).toBeLessThanOrEqual(confirmationBox.y + 1);
		expect(confirmationBox.height).toBeGreaterThanOrEqual(44);
		await expectNoOverflow(alert);
		await expectNoOverflow(confirmation);
	});

	test('a chore removal stays pending until the server answers and is retryable after a failure', async ({
		page,
	}) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const title = 'Fenster putzen';
		let deleteCalls = 0;
		let releaseFirstDelete: () => void = () => {};
		const firstDeleteGate = new Promise<void>((resolve) => {
			releaseFirstDelete = resolve;
		});
		await page.route(`**/api/wg/${SHARE_CODE}/chores/removal-pending`, async (route) => {
			if (route.request().method() !== 'DELETE') return route.fallback();
			deleteCalls += 1;
			if (deleteCalls === 1) {
				await firstDeleteGate;
				return route.fulfill({ status: 500, json: { error: 'server_error' } });
			}
			return route.fulfill({ json: {} });
		});
		await openPutzen(page, [viewer], [{ ...chore('removal-pending', viewer.id), title }], [], true);

		const row = page.locator('#chore-removal-pending');
		await row.getByRole('button', { name: `Aufgabenaktionen: ${title}` }).click();
		const remove = page.getByRole('button', { name: new RegExp(`entfernen: ${title}$`) });
		await remove.click();
		await remove.click();
		await expect(remove).toBeDisabled();
		releaseFirstDelete();

		await expect(
			page.getByText('Entfernen fehlgeschlagen. Versuche es gleich erneut.'),
		).toBeVisible();
		await expect(remove).toBeEnabled();
		expect(deleteCalls).toBe(1);
	});

	test('hides permanent chore removal from non-admin members', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const title = 'Aufgabe delete-permission';
		const rows = [chore('delete-permission', viewer.id)];

		await openPutzen(page, [viewer], rows, []);
		await page.getByRole('button', { name: `Aufgabenaktionen: ${title}` }).click();
		await expect(page.getByRole('button', { name: `Aufgabe entfernen: ${title}` })).toHaveCount(0);
	});

	test('offers other members for an absence only to admins', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const other: FixtureMember = { id: 'anna', name: 'Anna', color: null, active: true };

		await openPutzen(page, [viewer, other], [chore('absence-select', viewer.id)], []);
		await page.getByRole('button', { name: 'Abwesenheit eintragen' }).click();
		await expect(page.getByLabel('Abwesendes Mitglied').locator('option')).toHaveText(['Abu']);
	});

	test('admins can pick another member for an absence', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const other: FixtureMember = { id: 'anna', name: 'Anna', color: null, active: true };

		await openPutzen(page, [viewer, other], [chore('absence-admin', viewer.id)], [], true);
		await page.getByRole('button', { name: 'Abwesenheit eintragen' }).click();
		await expect(page.getByLabel('Abwesendes Mitglied').locator('option')).toHaveText([
			'Abu',
			'Anna',
		]);
	});

	test('explains an absence that overlaps an existing one', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };

		await openPutzen(page, [viewer], [chore('absence-overlap', viewer.id)], []);
		await page.route(`**/api/wg/${SHARE_CODE}/absences`, (route) =>
			route.request().method() === 'POST'
				? route.fulfill({
						status: 409,
						json: { error: 'absence_overlaps_existing', code: 'absence_overlaps_existing' },
					})
				: route.fallback(),
		);
		await page.getByRole('button', { name: 'Abwesenheit eintragen' }).click();
		const day = (offset: number) =>
			new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
		await page.getByLabel('Abwesenheit von').fill(day(2));
		await page.getByLabel('Abwesenheit bis').fill(day(4));
		await page.getByRole('button', { name: 'Abwesenheit speichern' }).click();
		await expect(
			page.getByText(
				'Abwesenheit konnte nicht gespeichert werden: Für diese Person gibt es im Zeitraum schon eine Abwesenheit.',
			),
		).toBeVisible();
	});

	test('rejects an absence that already ended', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		let posts = 0;

		await openPutzen(page, [viewer], [chore('absence-past', viewer.id)], []);
		await page.route(`**/api/wg/${SHARE_CODE}/absences`, (route) => {
			if (route.request().method() !== 'POST') return route.fallback();
			posts += 1;
			return route.fulfill({ json: { absence: null } });
		});
		await page.getByRole('button', { name: 'Abwesenheit eintragen' }).click();
		await page.getByLabel('Abwesenheit von').fill('2020-01-01');
		await page.getByLabel('Abwesenheit bis').fill('2020-01-05');
		await page.getByRole('button', { name: 'Abwesenheit speichern' }).click();
		await expect(
			page.getByText('Das Ende der Abwesenheit liegt in der Vergangenheit.'),
		).toBeVisible();
		expect(posts).toBe(0);
	});

	test('shows the authoritative next member and labels the viewer as du', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const absentMember: FixtureMember = { id: 'ben', name: 'Ben', color: null, active: true };
		const choreOwner: FixtureMember = { id: 'anna', name: 'Anna', color: null, active: true };
		const departedMember: FixtureMember = { id: 'dora', name: 'Dora', color: null, active: false };
		const members = [viewer, absentMember, choreOwner, departedMember];
		const chores = [chore('viewer-next', 'anna')];
		const absences = [absence(absentMember)];
		const activeMembers = members
			.filter((member) => member.active)
			.map(({ id, name }) => ({ id, name }));
		const nextMember = chooseNextAvailableMember({
			members: activeMembers,
			currentMemberId: 'anna',
			absentMemberIds: ['ben'],
			chores,
		});
		expect(nextMember).toBe(CURRENT_MEMBER);

		await openPutzen(page, members, chores, absences);
		const row = page.locator('#chore-viewer-next');
		await expect(row).toContainText('danach du');
		await expect(row.getByText('Zuständig: Anna')).toBeVisible();
	});

	test('states when no active member is eligible for the next round', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const choreOwner: FixtureMember = { id: 'anna', name: 'Anna', color: null, active: true };
		const departedMember: FixtureMember = { id: 'dora', name: 'Dora', color: null, active: false };
		const members = [viewer, choreOwner, departedMember];
		const chores = [chore('no-successor', 'anna')];
		const nextDueCoveredUntil = new Date(Date.now() + 8 * 86_400_000).toISOString();
		const absences = [absence(viewer), absence(choreOwner)].map((entry) => ({
			...entry,
			endDate: nextDueCoveredUntil,
		}));
		const activeMembers = members
			.filter((member) => member.active)
			.map(({ id, name }) => ({ id, name }));
		const nextMember = chooseNextAvailableMember({
			members: activeMembers,
			currentMemberId: 'anna',
			absentMemberIds: [CURRENT_MEMBER, 'anna'],
			chores,
		});
		expect(nextMember).toBeNull();

		await openPutzen(page, members, chores, absences);
		const row = page.locator('#chore-no-successor');
		await expect(row).not.toContainText('danach');
		await expect(row.getByText('Dora', { exact: true })).toHaveCount(0);
	});

	test('wraps a long predicted name at phone widths in both themes', async ({ page }, testInfo) => {
		const owner: FixtureMember = { id: 'anna', name: 'Anna', color: null, active: true };
		const longNext: FixtureMember = {
			id: 'long-next',
			name: 'Alexandria-Winterstein-Schwarzenberg',
			color: null,
			active: true,
		};
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const members = [owner, longNext, viewer];
		const chores = [chore('long-next', owner.id)];
		const predicted = chooseNextAvailableMember({
			members: members.map(({ id, name }) => ({ id, name })),
			currentMemberId: owner.id,
			absentMemberIds: [],
			chores,
		});
		expect(predicted).toBe(longNext.id);

		await openPutzen(page, members, chores, []);
		const row = page.locator('#chore-long-next');
		await expect(row).toContainText(`danach ${longNext.name}`);

		for (const theme of ['light', 'dark'] as const) {
			for (const width of [320, 390]) {
				await page.setViewportSize({ width, height: 844 });
				await page.emulateMedia({ colorScheme: theme });
				await page.evaluate(() => window.scrollTo(0, 0));
				const layout = await page.evaluate(() => ({
					viewport: document.documentElement.clientWidth,
					page: document.documentElement.scrollWidth,
				}));
				expect(layout.page).toBeLessThanOrEqual(layout.viewport);
				await page.screenshot({
					path: testInfo.outputPath(`putzen-${width}-${theme}.png`),
					animations: 'disabled',
				});
			}
		}
	});

	test('restores the automatic assignee for a titled draft and posts it', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		await openPutzen(page, [viewer], [], []);
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();

		const title = page.getByPlaceholder('z. B. Müll rausbringen');
		const assignee = page.getByLabel('Zuständig');
		await title.fill('Automatisch zugewiesener Entwurf');
		await expect(assignee).toHaveValue(CURRENT_MEMBER);
		await page.reload();
		await expect(title).toBeVisible();
		await expect(title).toHaveValue('Automatisch zugewiesener Entwurf');
		await expect(assignee).toHaveValue(CURRENT_MEMBER);

		let postedAssigneeId: unknown;
		await page.route(`**/api/wg/${SHARE_CODE}/chores`, async (route) => {
			if (route.request().method() === 'POST') {
				postedAssigneeId = route.request().postDataJSON().assignedMemberId;
				await route.fulfill({ status: 201, json: { warning: null } });
				return;
			}
			await route.fallback();
		});
		await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
		await expect.poll(() => postedAssigneeId).toBe(CURRENT_MEMBER);
	});

	test('names a rate limit as retryable instead of a generic save failure', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		await openPutzen(page, [viewer], [], []);
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
		await page.getByPlaceholder('z. B. Müll rausbringen').fill('Zu schnell');
		// Die Middleware antwortet mit `rate_limited`, nicht mit `too_many_requests`.
		await page.route(`**/api/wg/${SHARE_CODE}/chores`, async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({ status: 429, json: { error: 'rate_limited' } });
				return;
			}
			await route.fallback();
		});
		await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
		await expect(
			page.getByText('Putzaufgabe konnte nicht gespeichert werden: Versuche es gleich erneut.'),
		).toBeVisible();
	});

	test('names an expired session and maintenance mode and keeps the draft', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		await openPutzen(page, [viewer], [], []);
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
		const title = page.getByPlaceholder('z. B. Müll rausbringen');
		await title.fill('Entwurf bleibt');
		let failure = { status: 401, json: { error: 'auth_required', code: 'auth_required' } };
		await page.route(`**/api/wg/${SHARE_CODE}/chores`, async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill(failure);
				return;
			}
			await route.fallback();
		});
		await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
		await expect(
			page.getByText(
				'Putzaufgabe konnte nicht gespeichert werden: Deine Sitzung ist abgelaufen. Melde dich neu an.',
			),
		).toBeVisible();
		await expect(title).toHaveValue('Entwurf bleibt');
		// Middleware bei MIGRATION_READ_ONLY: 503 `migration_read_only`.
		failure = { status: 503, json: { error: 'migration_read_only', retryAfter: '300' } };
		await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
		await expect(
			page.getByText(
				'Putzaufgabe konnte nicht gespeichert werden: Die App ist gerade in Wartung und nur lesbar. Versuche es später erneut.',
			),
		).toBeVisible();
		await expect(title).toHaveValue('Entwurf bleibt');
	});

	test('preserves explicit and legacy unassigned chore drafts', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		await openPutzen(page, [viewer], [], []);
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();

		const title = page.getByPlaceholder('z. B. Müll rausbringen');
		const assignee = page.getByLabel('Zuständig');
		await title.fill('Ohne Zuständigkeit');
		await expect(assignee).toHaveValue(CURRENT_MEMBER);
		await assignee.selectOption('');
		const draftKey = buildDraftKey(SHARE_CODE, CURRENT_MEMBER, 'chore');
		await expect
			.poll(() =>
				page.evaluate((key) => {
					const raw = localStorage.getItem(key);
					return raw ? (JSON.parse(raw) as Record<string, unknown>).assigneeTouched : undefined;
				}, draftKey),
			)
			.toBe(true);
		await page.reload();
		await expect(title).toBeVisible();
		await expect(assignee).toHaveValue('');

		await page.evaluate(
			(key) =>
				localStorage.setItem(
					key,
					JSON.stringify({
						title: 'Legacy empty assignee',
						intervalDays: 7,
						recurrenceType: 'days',
						assignedMemberId: '',
					}),
				),
			draftKey,
		);
		await page.reload();
		await expect(title).toBeVisible();
		await expect(title).toHaveValue('Legacy empty assignee');
		await expect(assignee).toHaveValue('');
	});

	test('does not reopen an untouched empty chore form after reload', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		await openPutzen(page, [viewer], [], []);
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
		const title = page.getByPlaceholder('z. B. Müll rausbringen');
		await expect(title).toBeVisible();
		await page.reload();
		await expect(title).toBeHidden();
	});

	test('keeps each compact chore action reachable at its painted edge', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		const flatmate: FixtureMember = {
			id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
			name: 'Mina',
			color: null,
			active: true,
		};
		const title = 'Edge-hit dishwasher';
		await openPutzen(page, [viewer, flatmate], [{ ...chore('edge-hit', flatmate.id), title }], []);

		const row = page.locator('#chore-edge-hit');
		const complete = row.getByRole('button', { name: `Als erledigt markieren: ${title}` });
		const completeBox = await complete.boundingBox();
		if (!completeBox) throw new Error('The completion button is not visible.');
		await page.mouse.click(
			completeBox.x + completeBox.width - 1,
			completeBox.y + completeBox.height / 2,
		);
		await expect(page.getByRole('alertdialog')).toBeVisible();
	});
});

test.describe('chores retry', () => {
	test('uses Berlin calendar days instead of rounding elapsed hours', () => {
		const now = Date.parse('2026-09-05T15:30:00+02:00');

		expect(getChoreStatus('2026-09-06T00:10:00+02:00', now)).toMatchObject({
			state: 'planned',
			label: 'morgen',
		});
		expect(getChoreStatus('2026-09-04T00:10:00+02:00', now)).toMatchObject({
			state: 'overdue',
			overdueDays: 1,
			label: 'seit 1 T. offen',
		});
	});
});

test.describe('chore swap coordination (pilot DB worker)', () => {
	test.setTimeout(120_000);
	test.skip(
		process.env.PILOT_FIXES_WORKER !== 'chores',
		'requires the dedicated pilot chores database worker',
	);

	test('completing a chore resolves only its linked swap post and shows the next due date', async ({
		page,
	}) => {
		const shareCode = process.env.PILOT_WG_CODE?.trim().toUpperCase() ?? '';
		const runtimeBaseUrl =
			test.info().project.use.baseURL?.toString() ??
			process.env.BASE_URL ??
			'http://127.0.0.1:3291';
		const runtimeHost = new URL(runtimeBaseUrl).hostname;
		if (!['127.0.0.1', 'localhost', '::1'].includes(runtimeHost)) {
			throw new Error('Pilot chore coordination E2E requires a loopback BASE_URL.');
		}
		if (!shareCode) {
			throw new Error('Set PILOT_WG_CODE for the pilot chores worker.');
		}
		const request = page.request;
		const title = `Pilot coordination ${Date.now()}`;
		const unrelatedSourcePath = '/putzen?highlight=00000000-0000-4000-8000-000000000000';
		const createdAnnouncementIds: string[] = [];
		let choreId: string | undefined;

		try {
			const choreResponse = await request.post(`/api/wg/${shareCode}/chores`, {
				data: {
					title,
					intervalDays: 7,
					recurrenceType: 'days',
					assignedMemberId: null,
				},
			});
			expect(choreResponse.ok()).toBe(true);
			const choreBody = (await choreResponse.json()) as {
				chore: {
					id: string;
					nextDueAt: string;
					assignedMemberId: string | null;
					createdAt: string;
				};
			};
			choreId = choreBody.chore.id;
			expect(Date.parse(choreBody.chore.nextDueAt)).toBeGreaterThan(
				Date.parse(choreBody.chore.createdAt),
			);

			const linkedSourcePath = `/putzen?highlight=${encodeURIComponent(choreId)}`;
			for (const sourcePath of [linkedSourcePath, unrelatedSourcePath]) {
				const announcementResponse = await request.post(`/api/wg/${shareCode}/announcements`, {
					data: {
						content: `${title} Tauschbitte ${sourcePath}`,
						kind: 'request',
						source: 'chore_swap',
						sourcePath,
					},
				});
				expect(announcementResponse.ok()).toBe(true);
				const announcementBody = (await announcementResponse.json()) as {
					announcement: { id: string };
				};
				createdAnnouncementIds.push(announcementBody.announcement.id);
			}

			const manualResponse = await request.post(`/api/wg/${shareCode}/announcements`, {
				data: { content: `${title} manueller Beitrag`, kind: 'info', source: 'manual' },
			});
			expect(manualResponse.ok()).toBe(true);
			const manualBody = (await manualResponse.json()) as { announcement: { id: string } };
			createdAnnouncementIds.push(manualBody.announcement.id);

			const completeResponse = await request.post(
				`/api/wg/${shareCode}/chores/${encodeURIComponent(choreId)}/complete`,
				{
					data: {
						expectedNextDueAt: choreBody.chore.nextDueAt,
						expectedAssignedMemberId: choreBody.chore.assignedMemberId,
					},
				},
			);
			expect(completeResponse.ok()).toBe(true);

			const announcementsResponse = await request.get(`/api/wg/${shareCode}/announcements`, {});
			expect(announcementsResponse.ok()).toBe(true);
			const announcementsBody = (await announcementsResponse.json()) as {
				announcements: Array<{
					id: string;
					status: string;
					resolvedAt: string | null;
					resolvedByMemberId: string | null;
					sourcePath: string | null;
				}>;
			};
			const linked = announcementsBody.announcements.find(
				(announcement) => announcement.sourcePath === linkedSourcePath,
			);
			const unrelated = announcementsBody.announcements.find(
				(announcement) => announcement.sourcePath === unrelatedSourcePath,
			);
			const manual = announcementsBody.announcements.find(
				(announcement) => announcement.id === manualBody.announcement.id,
			);
			expect(linked).toMatchObject({ status: 'resolved', resolvedAt: expect.any(String) });
			expect(linked?.resolvedByMemberId).toBeTruthy();
			expect(unrelated).toMatchObject({
				status: 'open',
				resolvedAt: null,
				resolvedByMemberId: null,
			});
			expect(manual).toMatchObject({ status: 'open', resolvedAt: null, resolvedByMemberId: null });
			if (!linked || !unrelated)
				throw new Error('Pilot announcements were not returned after completion.');
			const staleTakeResponse = await request.post(
				`/api/wg/${shareCode}/announcements/${linked.id}/reactions`,
				{ data: { reaction: 'take' } },
			);
			expect(staleTakeResponse.status()).toBe(400);
			expect(await staleTakeResponse.json()).toMatchObject({ error: 'reaction_invalid' });
			const resolvedOkResponse = await request.post(
				`/api/wg/${shareCode}/announcements/${linked.id}/reactions`,
				{ data: { reaction: 'ok' } },
			);
			expect(resolvedOkResponse.ok()).toBe(true);

			await page.goto(`/wg/${shareCode}/pinnwand`);
			const linkedCard = page.locator(`li#announcement-${linked.id}`);
			const unrelatedCard = page.locator(`li#announcement-${unrelated.id}`);
			await expect(linkedCard).toContainText('Geklärt');
			await expect(linkedCard).not.toContainText('Übernehme ich');
			await expect(unrelatedCard).toContainText('Übernehme ich');
			await page.screenshot({
				path: test.info().outputPath('pinnwand-resolved.png'),
				fullPage: true,
			});

			await page.goto(`/wg/${shareCode}/putzen`);
			await expect(page.locator(`li#chore-${choreId}`)).toContainText('wöchentlich');
			await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
			await expect(page.getByText('Erste Fälligkeit: in 7 Tagen.', { exact: false })).toBeVisible();
		} finally {
			for (const announcementId of createdAnnouncementIds) {
				await request
					.delete(`/api/wg/${shareCode}/announcements/${announcementId}`)
					.catch(() => undefined);
			}
			if (choreId) {
				await request.delete(`/api/wg/${shareCode}/chores/${choreId}`).catch(() => undefined);
			}
		}
	});
});

test.describe('domain regressions (recurring retry, activity, fairness)', () => {
	const NOW = Date.parse('2026-09-19T12:00:00.000Z');

	function activity(id: string, text: string, completed: boolean): ActivityItem {
		return {
			id,
			kind: 'chore',
			timestamp: new Date(NOW).toISOString(),
			memberId: 'member-1',
			memberName: 'Abu',
			text,
			completed,
		} as ActivityItem;
	}

	test('retries a recurring advance carried by an expense action', () => {
		const createRetry = Reflect.get(offlineClient, 'createRecurringAdvanceRetry') as
			| ((action: Record<string, unknown>, now: number) => unknown)
			| undefined;

		expect(createRetry).toBeDefined();
		const retry = createRetry?.(
			{
				id: 'queued-recurring',
				type: 'expense.create',
				shareCode: 'WGCODE',
				memberId: 'member-1',
				createdAt: new Date(NOW).toISOString(),
				payload: {
					recurringExpenseId: 'recurring-1',
					expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
				},
			},
			NOW,
		);

		expect(retry).toMatchObject({
			type: 'recurring.advance',
			payload: {
				recurringExpenseId: 'recurring-1',
				expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
			},
		});
	});

	test('activity done and changes scopes respect chore completion state', () => {
		const items = [activity('open', 'Flur geplant', false), activity('done', 'Bad erledigt', true)];

		expect(filterActivityByScope(items, 'done', 'Abu', 'member-1').map((item) => item.id)).toEqual([
			'done',
		]);
		expect(
			filterActivityByScope(items, 'changes', 'Abu', 'member-1').map((item) => item.id),
		).toEqual(['open']);
	});

	test('uses the API-repeated open-gap total once for an assignee', () => {
		const fairness = buildChoreFairness({
			members: [{ id: 'member-1', name: 'Abu' }],
			chores: [
				{
					assignedMemberId: 'member-1',
					openGapCountForAssignee: 2,
					nextDueAt: '2026-09-20T12:00:00.000Z',
				},
				{
					assignedMemberId: 'member-1',
					openGapCountForAssignee: 2,
					nextDueAt: '2026-09-20T12:00:00.000Z',
				},
			],
			now: NOW,
		});

		expect(fairness.rows[0]).toMatchObject({ openGapCount: 2, score: 10 });
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
