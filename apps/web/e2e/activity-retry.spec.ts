import { type Page, expect, test } from '@playwright/test';

async function gotoWithRetry(page: Page, path: string) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			return;
		} catch (err) {
			lastError = err;
			await page.waitForTimeout(1000);
		}
	}
	throw lastError;
}

function activityBody(text: string) {
	return {
		items: [
			{
				id: `activity-${text}`,
				kind: 'shopping',
				timestamp: new Date().toISOString(),
				memberName: 'dsaf',
				text,
				detail: 'Einkauf',
				href: '/einkauf',
			},
		],
		reminders: [],
	};
}

test.describe('Activity recovery', () => {
	test.setTimeout(240_000);

	test('lets users retry after activity loading fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let failActivity = true;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/activity', async (route) => {
			if (failActivity) {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'server_error' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'activity-1',
							kind: 'shopping',
							timestamp: new Date().toISOString(),
							memberName: 'dsaf',
							text: 'hat Hafermilch eingetragen',
							detail: 'Einkauf',
							href: '/einkauf',
						},
					],
					reminders: [],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/aktivitaet');
		await expect(
			page.getByText('Aktivität konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText('Keine Aktivität geladen. Versuche es erneut.')).toBeVisible();

		failActivity = false;
		await page.getByRole('button', { name: 'Aktivität erneut laden' }).click();

		await expect(page.getByText('Dein Einkauf')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('1 für dich')).toBeVisible();
		await expect(page.getByText('1 offen')).toBeHidden();
		await expect(
			page.getByText('Aktivität konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeHidden();
	});

	test('explains stale membership when activity loading is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/activity', async (route) => {
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/aktivitaet');

		await expect(
			page.getByText('Aktivität konnte nicht geladen werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Aktivität konnte nicht geladen werden.')).toHaveCount(0);
	});

	test('lets users reset activity filters when the chronicle is empty', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/activity', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'activity-shopping',
							kind: 'shopping',
							timestamp: new Date().toISOString(),
							memberName: 'dsaf',
							text: 'hat Hafermilch eingetragen',
							detail: 'Einkauf',
							href: '/einkauf',
						},
					],
					reminders: [],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/aktivitaet');
		await expect(page.getByText('Dein Einkauf')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('status')).toHaveText('1 Chronik-Eintrag sichtbar.');
		await expect(page.getByLabel('Aktivitätsumfang filtern')).toBeVisible();
		await expect(page.getByLabel('Aktivitätstyp filtern')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Aktivitätsumfang: Alle' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.getByRole('button', { name: 'Aktivitätstyp: Alle' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);

		await page.getByPlaceholder('Aktivität durchsuchen').fill('Miete');
		await expect(page.getByRole('status')).toHaveText('Keine sichtbaren Chronik-Einträge.');
		await expect(page.getByText('Keine Aktivität für diesen Filter.')).toBeVisible();

		await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();

		await expect(page.getByPlaceholder('Aktivität durchsuchen')).toHaveValue('');
		await expect(page.getByText('Dein Einkauf')).toBeVisible();
		await expect(page.getByRole('status')).toHaveText('1 Chronik-Eintrag sichtbar.');
		await expect(page.getByText('Keine Aktivität für diesen Filter.')).toBeHidden();
	});

	test('guides empty activity pages toward first useful actions', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/activity', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ items: [], reminders: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/aktivitaet');

		await expect(page.getByText('Noch keine Aktivität.')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Keine Aktivität für diesen Filter.')).toBeHidden();
		await expect(page.getByRole('link', { name: 'Ausgabe eintragen' })).toHaveAttribute(
			'href',
			'/wg/MTE8PZAT/ausgaben?desc=Internet&amount=32%2C90',
		);
		await expect(page.getByRole('link', { name: 'Pinnwand starten' })).toHaveAttribute(
			'href',
			'/wg/MTE8PZAT/pinnwand?content=Paket+im+Flur&kind=question',
		);
		await expect(page.getByRole('link', { name: 'Putzplan anlegen' })).toHaveAttribute(
			'href',
			'/wg/MTE8PZAT/putzen?title=Bad+putzen',
		);
	});

	test('keeps activity refresh disabled while a refresh request is pending', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let requests = 0;
		let delayNextActivity = false;
		let releaseRefresh: () => void = () => undefined;
		const refreshCanFinish = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/activity', async (route) => {
			requests += 1;
			if (delayNextActivity) {
				await refreshCanFinish;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(activityBody('hat frischen Kaffee eingetragen')),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(activityBody('hat Hafermilch eingetragen')),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/aktivitaet');
		await expect(page.getByRole('link', { name: /dsaf hat Hafermilch eingetragen/ })).toBeVisible({
			timeout: 30_000,
		});
		const refreshButton = page.getByRole('button', { name: 'Aktivität aktualisieren' });
		await expect(refreshButton).toBeEnabled();
		delayNextActivity = true;
		const requestsBeforeRefresh = requests;
		await refreshButton.click();
		await expect(refreshButton).toBeDisabled();
		await refreshButton.click({ force: true });
		await expect.poll(() => requests).toBe(requestsBeforeRefresh + 1);

		releaseRefresh();

		await expect(
			page.getByRole('link', { name: /dsaf hat frischen Kaffee eingetragen/ }),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(refreshButton).toBeEnabled();
	});
});
