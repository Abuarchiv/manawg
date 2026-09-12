import { type Page, expect, test } from '@playwright/test';

const TWO_MEMBER_WG = {
	code: 'MTE8PZAT',
	wgId: '989ac820-58b7-431f-9c65-28721264f333',
	memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
	memberName: 'dsaf',
};

const SINGLE_MEMBER_WG = {
	code: 'SMKETEST',
	wgId: 'f3cfbb01-844c-4ba6-9ea7-0ee8d68b0d83',
	memberId: 'a2c3f1b7-2fd9-476b-9e25-a1c8c0115db1',
	memberName: 'Smoke Tester',
};

async function gotoWithRetry(page: Page, path: string): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			return;
		} catch (error) {
			lastError = error;
			await page.waitForTimeout(1_000);
		}
	}
	throw lastError;
}

async function seedIdentity(page: Page, wg: typeof TWO_MEMBER_WG): Promise<void> {
	await page.addInitScript((identity) => {
		localStorage.clear();
		localStorage.setItem(
			`manawg_identity:${identity.wgId}`,
			JSON.stringify({ memberId: identity.memberId, name: identity.memberName }),
		);
	}, wg);
}

test.describe('Account and WG settings experience', () => {
	test.setTimeout(300_000);

	test('persists WG leave before clearing local identity and ignores duplicate clicks', async ({
		page,
	}) => {
		let patchRequests = 0;
		await seedIdentity(page, TWO_MEMBER_WG);
		await page.route(
			`**/api/wg/${TWO_MEMBER_WG.code}/members/${TWO_MEMBER_WG.memberId}`,
			async (route) => {
				if (route.request().method() === 'GET') {
					await route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({
							member: {
								id: TWO_MEMBER_WG.memberId,
								name: TWO_MEMBER_WG.memberName,
								active: true,
							},
							openBalances: [
								{
									member_id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
									name: 'Mina',
									amount_cents: 1_000,
									direction: 'owed',
								},
							],
						}),
					});
					return;
				}
				if (route.request().method() !== 'PATCH') return route.fallback();
				patchRequests += 1;
				expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({ active: false });
				await new Promise((resolve) => setTimeout(resolve, 250));
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						member: {
							id: TWO_MEMBER_WG.memberId,
							name: TWO_MEMBER_WG.memberName,
							active: false,
						},
					}),
				});
			},
		);

		await gotoWithRetry(page, `/wg/${TWO_MEMBER_WG.code}/einstellungen#zugang`);
		await page.getByRole('button', { name: 'WG auf diesem Gerät verlassen' }).click();
		await expect(
			page.getByText('Offene Salden bleiben nach dem Verlassen bestehen:'),
		).toBeVisible();
		await expect(page.getByText('Mina schuldet')).toBeVisible();
		await expect(
			page.getByText(/aktives Admin-Mitglied mit der nötigen Berechtigung/),
		).toBeVisible();
		const confirm = page
			.getByRole('dialog')
			.getByRole('button', { name: 'WG auf diesem Gerät verlassen' });
		await confirm.evaluate((button) => {
			button.click();
			button.click();
		});

		await expect.poll(() => patchRequests).toBe(1);
		await expect(page).toHaveURL(/\/$/);
	});

	test('keeps membership UI and offers a retry after WG leave fails', async ({ page }) => {
		let patchRequests = 0;
		await seedIdentity(page, TWO_MEMBER_WG);
		await page.route(
			`**/api/wg/${TWO_MEMBER_WG.code}/members/${TWO_MEMBER_WG.memberId}`,
			async (route) => {
				if (route.request().method() !== 'PATCH') return route.fallback();
				patchRequests += 1;
				if (patchRequests === 1) {
					await route.fulfill({
						status: 503,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'temporarily_unavailable' }),
					});
					return;
				}
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						member: {
							id: TWO_MEMBER_WG.memberId,
							name: TWO_MEMBER_WG.memberName,
							active: false,
						},
					}),
				});
			},
		);

		await gotoWithRetry(page, `/wg/${TWO_MEMBER_WG.code}/einstellungen#zugang`);
		await page.getByRole('button', { name: 'WG auf diesem Gerät verlassen' }).click();
		const confirm = page
			.getByRole('dialog')
			.getByRole('button', { name: 'WG auf diesem Gerät verlassen' });
		await confirm.click();
		await expect(
			page.getByRole('alert').filter({ hasText: 'WG konnte nicht verlassen werden' }),
		).toContainText('Deine Mitgliedschaft bleibt bestehen');
		await expect(page.getByText('Wirklich verlassen?')).toBeVisible();
		await expect(
			page.getByRole('dialog').getByRole('button', { name: 'WG auf diesem Gerät verlassen' }),
		).toBeEnabled();
		expect(
			await page.evaluate(
				(wgId) => localStorage.getItem(`manawg_identity:${wgId}`),
				TWO_MEMBER_WG.wgId,
			),
		).not.toBeNull();

		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'WG auf diesem Gerät verlassen' })
			.click();
		await expect.poll(() => patchRequests).toBe(2);
		await expect(page).toHaveURL(/\/$/);
	});

	test('prevents the last active member from leaving and offers device sign-out', async ({
		page,
	}) => {
		await seedIdentity(page, SINGLE_MEMBER_WG);
		await gotoWithRetry(page, `/wg/${SINGLE_MEMBER_WG.code}/einstellungen#zugang`);

		const leaveRegion = page.getByRole('region', { name: 'WG verlassen' });
		await expect(leaveRegion).toContainText('Du bist das letzte aktive Mitglied.');
		await expect(
			leaveRegion.getByRole('button', { name: 'WG auf diesem Gerät verlassen' }),
		).toHaveCount(0);
		await expect(
			leaveRegion.getByRole('button', { name: 'Stattdessen Konto abmelden' }),
		).toBeVisible();
		await expect(leaveRegion).toContainText('Deine Mitgliedschaft bleibt bestehen');
	});

	test('explains account-backed membership, local offline state, PayPal scope, and canonical legal links', async ({
		page,
	}) => {
		await seedIdentity(page, TWO_MEMBER_WG);
		await gotoWithRetry(page, `/wg/${TWO_MEMBER_WG.code}/einstellungen#profil`);

		await expect(
			page.getByText(
				'Dein Account ist mit dieser WG-Mitgliedschaft verbunden. Nicht synchronisierte Entwürfe und Offline-Aktionen bleiben auf diesem Gerät.',
			),
		).toBeVisible();
		await expect(page.getByText('Diese Identität ist nur an dieses Gerät gebunden.')).toHaveCount(
			0,
		);
		await expect(page.getByText(/Speichern.*überweist kein Geld/)).toBeVisible();
		await expect(page.getByText(/keine PayPal-Freischaltung/)).toBeVisible();

		await page.goto(`/wg/${TWO_MEMBER_WG.code}/einstellungen#daten`);
		const impressum = page.getByRole('link', { name: /Impressum/ });
		const agb = page.getByRole('link', { name: /AGB/ });
		await expect(impressum).toHaveAttribute('href', 'https://manawg.com/impressum');
		await expect(impressum).toHaveAttribute('target', '_blank');
		await expect(impressum).toHaveAttribute('rel', /noopener/);
		await expect(agb).toHaveAttribute('href', 'https://manawg.com/agb');
		await expect(agb).toHaveAttribute('target', '_blank');
		await expect(agb).toHaveAttribute('rel', /noopener/);
		await expect(page.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute(
			'href',
			'/datenschutz',
		);
		await expect(page.getByText(/WG-Daten und Mitgliedschaft liegen im Account/)).toBeVisible();
	});
});
