// Chores: the absence cache after completions, pending absence removals, swap coordination on the
// pilot database worker and week status errors.

import { expect, test } from '@playwright/test';
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
