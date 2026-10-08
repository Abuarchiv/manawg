// Chores: next assignee and fairness rotation.
// Why: Fair rotation and Berlin calendar-day maths regress silently without explicit cases.

import { type Locator, expect, test } from '@playwright/test';
import { buildDraftKey } from '../src/core/offline/drafts';
import { chooseNextAvailableMember } from '../src/features/chores/chore-fairness';
import { EXPECTED_MEMBER_ID_HEADER } from '../src/shared/lib/member-header';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
} from './support/helpers';

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
		const memberHeaders: Array<string | undefined> = [];
		await page.route(`**/api/wg/${SHARE_CODE}/members`, (route) => {
			memberHeaders.push(route.request().headers()[EXPECTED_MEMBER_ID_HEADER]);
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
		await expect.poll(() => memberHeaders.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
		expect(memberHeaders.every((memberId) => memberId === CURRENT_MEMBER)).toBe(true);
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
		// Taking over is only offered on other members' chores.
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
		// The follow-up assignee is shown in the actions drawer, not in the row.
		await expect(row).not.toContainText('danach');
		await row.getByRole('button', { name: /^Aufgabenaktionen:/ }).click();
		await expect(page.getByRole('dialog').getByText('Danach').locator('+ dd')).toHaveText('du');
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
		await expect(row.getByText('Dora', { exact: true })).toHaveCount(0);
		await row.getByRole('button', { name: /^Aufgabenaktionen:/ }).click();
		await expect(page.getByRole('dialog').getByText('Danach').locator('+ dd')).toHaveText(
			'niemand verfügbar',
		);
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
		await row.getByRole('button', { name: /^Aufgabenaktionen:/ }).click();
		await expect(page.getByRole('dialog').getByText('Danach').locator('+ dd')).toHaveText(
			longNext.name,
		);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();

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
		// A draft does not expand the form by itself; only „Putzaufgabe hinzufügen“ reveals it.
		await expect(title).toBeHidden();
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
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
		await page.getByRole('button', { name: 'Aufgabe speichern' }).click();
		await expect.poll(() => postedAssigneeId).toBe(CURRENT_MEMBER);
	});

	test('names a rate limit as retryable instead of a generic save failure', async ({ page }) => {
		const viewer: FixtureMember = { id: CURRENT_MEMBER, name: 'Abu', color: null, active: true };
		await openPutzen(page, [viewer], [], []);
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
		await page.getByPlaceholder('z. B. Müll rausbringen').fill('Zu schnell');
		// The middleware answers with `rate_limited`, not `too_many_requests`.
		await page.route(`**/api/wg/${SHARE_CODE}/chores`, async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({ status: 429, json: { error: 'rate_limited' } });
				return;
			}
			await route.fallback();
		});
		await page.getByRole('button', { name: 'Aufgabe speichern' }).click();
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
		let failure: { status: number; json: Record<string, string> } = {
			status: 401,
			json: { error: 'auth_required', code: 'auth_required' },
		};
		await page.route(`**/api/wg/${SHARE_CODE}/chores`, async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill(failure);
				return;
			}
			await route.fallback();
		});
		await page.getByRole('button', { name: 'Aufgabe speichern' }).click();
		await expect(
			page.getByText(
				'Putzaufgabe konnte nicht gespeichert werden: Deine Sitzung ist abgelaufen. Melde dich neu an.',
			),
		).toBeVisible();
		await expect(title).toHaveValue('Entwurf bleibt');
		// Middleware with MIGRATION_READ_ONLY: 503 `migration_read_only`.
		failure = { status: 503, json: { error: 'migration_read_only', retryAfter: '300' } };
		await page.getByRole('button', { name: 'Aufgabe speichern' }).click();
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
		// A draft does not expand the form by itself; only „Putzaufgabe hinzufügen“ reveals it.
		await expect(title).toBeHidden();
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
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
		// A draft does not expand the form by itself; only „Putzaufgabe hinzufügen“ reveals it.
		await expect(title).toBeHidden();
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
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
