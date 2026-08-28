import { type Page, expect, test } from '@playwright/test';

async function gotoWithRetry(page: Page, path: string) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			if ((await page.locator('body').innerText()).includes('Internal Server Error')) {
				throw new Error('Next dev server returned Internal Server Error');
			}
			return;
		} catch (err) {
			lastError = err;
			await page.waitForTimeout(1500);
		}
	}
	throw lastError;
}

test.describe('ManaWG core flows', () => {
	test.setTimeout(600_000);

	test('dashboard, expenses prefill, chores absences, and settings queue render for an existing WG', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const recurringTemplateId = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';
		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'recurring:MTE8PZAT:editable',
							type: 'recurring.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: {
								description: 'Internet',
								amountCents: 3290,
								paidByMemberId: memberId,
								intervalMonths: 1,
								nextDueAt: '2026-05-20T00:00:00.000Z',
								splits: [{ debtorMemberId: memberId, amountCents: 3290 }],
							},
						},
					]),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-core-1',
							authorMemberId: memberId,
							content: 'Paket im Flur',
							imageUrl: null,
							kind: 'question',
							status: 'open',
							source: 'manual',
							sourcePath: null,
							pinnedAt: null,
							resolvedAt: null,
							resolvedByMemberId: null,
							createdAt: new Date().toISOString(),
							reactionCounts: {},
							myReactions: [],
							takers: [],
							comments: [],
						},
					],
				}),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: [
						{
							id: recurringTemplateId,
							wgId,
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Internet',
							amountCents: 3290,
							intervalMonths: 1,
							nextDueAt: new Date(Date.now() - 86_400_000).toISOString(),
							lastCreatedAt: null,
							createdAt: new Date().toISOString(),
							splits: [{ debtorMemberId: memberId, amountCents: 3290 }],
						},
					],
				}),
			});
		});

		const dashboardResponse = page
			.waitForResponse(
				(response) =>
					response.url().includes('/api/wg/MTE8PZAT/dashboard') && response.status() === 200,
				{ timeout: 90_000 },
			)
			.catch(() => undefined);
		await gotoWithRetry(page, '/wg/MTE8PZAT');
		await dashboardResponse;
		await expect(page.getByText('WG-Gesundheit')).toBeVisible({ timeout: 60_000 });
		await expect(
			page.getByRole('link', { name: '1 Offline-Aktion wartet auf Synchronisierung.' }),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('link', { name: /Fixkosten fällig/ })).toBeVisible({
			timeout: 30_000,
		});

		await page.evaluate(() => {
			localStorage.setItem(
				'manawg:draft:MTE8PZAT:expense',
				JSON.stringify({ description: 'Alter Entwurf', amountStr: '1,00' }),
			);
		});
		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?desc=Internet&amount=32,90');
		await expect(page.locator('#f-beschreibung')).toHaveValue('Internet', {
			timeout: 30_000,
		});
		await expect(page.locator('#f-betrag')).toHaveValue('32,90', {
			timeout: 30_000,
		});
		await expect(page.locator('button').filter({ hasText: 'Als Vorlage merken' })).toBeVisible({
			timeout: 30_000,
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');
		await expect(page.getByText('Fixkosten-Fokus')).toBeVisible({ timeout: 30_000 });
		await gotoWithRetry(page, `/wg/MTE8PZAT/ausgaben?recurring=${recurringTemplateId}`);
		await expect(page.locator(`#recurring-${recurringTemplateId}`)).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.locator('#f-beschreibung')).toHaveValue('Internet', {
			timeout: 30_000,
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(page.getByRole('heading', { name: 'Putzplan' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: 'Putzaufgabe erfassen' })).toBeVisible({
			timeout: 30_000,
		});
		await page.evaluate(() => {
			localStorage.setItem(
				'manawg:draft:MTE8PZAT:chore',
				JSON.stringify({ title: 'Alter Putzplan' }),
			);
		});
		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen?title=Bad%20putzen');
		await expect(
			page.getByRole('button', { name: /^(Putzaufgabe erfassen|Putzaufgabe-Formular schließen)$/ }),
		).toBeVisible({
			timeout: 30_000,
		});
		if (await page.getByRole('button', { name: 'Putzaufgabe erfassen' }).isVisible()) {
			await page.getByRole('button', { name: 'Putzaufgabe erfassen' }).click();
		}
		await expect(page.locator('#chore-title')).toHaveValue('Bad putzen', { timeout: 60_000 });
		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen?filter=overdue');
		await expect(page.getByText('Putzlücken-Fokus')).toBeVisible({ timeout: 30_000 });
		const absenceId = '11111111-1111-4111-8111-111111111111';
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					absences: [
						{
							id: absenceId,
							memberId,
							memberName: 'dsaf',
							startDate: new Date(Date.now()).toISOString(),
							endDate: new Date(Date.now() + 86_400_000).toISOString(),
							reason: 'Urlaub',
						},
					],
				}),
			});
		});
		await gotoWithRetry(page, `/wg/MTE8PZAT/putzen?panel=absences&absence=${absenceId}`);
		await expect(page.getByText('Abwesenheits-Fokus')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator(`#absence-${absenceId}`)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(/Urlaub/)).toBeVisible({ timeout: 30_000 });

		await page.evaluate(() => {
			localStorage.setItem(
				'manawg:draft:MTE8PZAT:shopping',
				JSON.stringify({ name: 'Alter Einkauf', quantity: '99' }),
			);
		});
		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf?name=Milch');
		await expect(page.getByPlaceholder('Was brauchen wir?')).toHaveValue('Milch', {
			timeout: 30_000,
		});
		await expect(page.getByPlaceholder('Menge')).toHaveValue('');

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand?status=open');
		await expect(page.getByRole('heading', { name: 'Pinnwand' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: 'Offen' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await page.evaluate(() => {
			localStorage.setItem(
				'manawg:draft:MTE8PZAT:announcement',
				JSON.stringify({ content: 'Alter Beitrag', kind: 'info' }),
			);
		});
		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand?content=Paket%20im%20Flur&kind=question');
		await expect(
			page.getByRole('button', { name: /^(Beitrag erstellen|Beitragsformular schließen)$/ }),
		).toBeVisible({
			timeout: 30_000,
		});
		if (await page.getByRole('button', { name: 'Beitrag erstellen' }).isVisible()) {
			await page.getByRole('button', { name: 'Beitrag erstellen' }).click();
		}
		await expect(page.locator('#announcement-content')).toHaveValue('Paket im Flur', {
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: 'Frage' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);

		await gotoWithRetry(page, '/wg/MTE8PZAT/aktivitaet');
		await expect(page.getByRole('heading', { name: 'Aktivität' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: 'Audit' })).toBeVisible({ timeout: 30_000 });

		await gotoWithRetry(page, '/wg/MTE8PZAT/suche');
		await expect(page.getByRole('button', { name: 'Abwesenheiten' })).toBeVisible({
			timeout: 30_000,
		});

		await page.evaluate(
			({ memberId }) => {
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'recurring:MTE8PZAT:editable',
							type: 'recurring.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: {
								description: 'Internet',
								amountCents: 3290,
								paidByMemberId: memberId,
								intervalMonths: 1,
								nextDueAt: '2026-05-20T00:00:00.000Z',
								splits: [{ debtorMemberId: memberId, amountCents: 3290 }],
							},
						},
						{
							id: 'chore:MTE8PZAT:complete',
							type: 'chore.complete',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: { choreId: 'missing-chore-id' },
						},
					]),
				);
			},
			{ memberId },
		);
		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByLabel('CSV-Bereich')).toBeVisible({ timeout: 30_000 });
		await page.getByLabel('CSV-Bereich').selectOption('absences');
		await expect(page.getByLabel('CSV-Bereich')).toHaveValue('absences');
		let releaseExport: (() => void) | undefined;
		const exportStarted = new Promise<void>((resolve) => {
			void page.route('**/api/wg/MTE8PZAT/export', async (route) => {
				resolve();
				await new Promise<void>((release) => {
					releaseExport = release;
				});
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ wg: { shareCode: 'MTE8PZAT' }, sections: [] }),
				});
			});
		});
		const jsonExportButton = page.getByRole('button', { name: 'WG-Daten als JSON exportieren' });
		await jsonExportButton.click();
		await exportStarted;
		await expect(
			page.getByRole('button', { name: 'WG-Daten werden als JSON exportiert' }),
		).toBeDisabled({
			timeout: 1000,
		});
		await expect(
			page.getByRole('button', { name: 'Abwesenheiten als CSV exportieren' }),
		).toBeDisabled({
			timeout: 1000,
		});
		releaseExport?.();
		await page.unroute('**/api/wg/MTE8PZAT/export');
		await expect(page.getByText('Offline-Warteschlange')).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole('button', { name: 'Offline-Aktion bearbeiten: Internet' }),
		).toHaveCount(1);
		await page.getByRole('button', { name: 'Offline-Aktion bearbeiten: Internet' }).click();
		await expect(page.getByText('Du bearbeitest eine wartende Fixkosten-Vorlage.')).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: 'Vorlage speichern' })).toHaveCount(1);
	});
});
