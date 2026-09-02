import { type Page, expect, test } from '@playwright/test';

function dashboardResponseBody(
	overrides: Partial<ReturnType<typeof dashboardResponseBodyBase>> = {},
) {
	return { ...dashboardResponseBodyBase(), ...overrides };
}

function dashboardResponseBodyBase() {
	const now = Date.now();
	const day = 86_400_000;
	return {
		balances: [
			{
				memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
				memberName: 'dsaf',
				color: '#6d5efc',
				paidCents: 3290,
				owedCents: 0,
				balanceCents: 3290,
			},
		],
		spendByDay: Array.from({ length: 14 }, (_, idx) => ({
			date: new Date(now - (13 - idx) * day).toISOString().slice(0, 10),
			cents: idx === 13 ? 3290 : 0,
		})),
		totalSpendCents: 3290,
		weekSpendCents: 3290,
		monthSpendCents: 3290,
		openShoppingCount: 1,
		openShoppingTop: ['Hafermilch'],
		dueChores: [],
		activity: [],
		latestAnnouncement: null,
		myOpenAnnouncements: [],
		wgHealth: {
			score: 100,
			label: 'ruhig',
			items: [
				{ label: 'Putzlücken', value: '0', tone: 'ok', href: '/wg/MTE8PZAT/putzen?filter=overdue' },
				{ label: 'Offene Schulden', value: '0,00 €', tone: 'ok', href: '/wg/MTE8PZAT/ausgaben' },
				{ label: 'Einkauf offen', value: '1', tone: 'ok', href: '/wg/MTE8PZAT/einkauf' },
				{
					label: 'Pinnwand offen',
					value: '0',
					tone: 'ok',
					href: '/wg/MTE8PZAT/pinnwand?status=open',
				},
				{ label: 'Abwesend', value: '0', tone: 'ok', href: '/wg/MTE8PZAT/putzen?panel=absences' },
				{
					label: 'Fixkosten fällig',
					value: '0',
					tone: 'ok',
					href: '/wg/MTE8PZAT/ausgaben?filter=recurring',
				},
			],
		},
		dueRecurringExpenses: [],
		absentMembers: [],
		setup: {
			choreCount: 1,
			hasExpense: true,
			hasShoppingItem: true,
			hasAnnouncement: false,
			notificationsEnabled: true,
		},
	};
}

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
			await page.waitForTimeout(1000);
		}
	}
	throw lastError;
}

test.describe('Dashboard recovery', () => {
	test.setTimeout(300_000);

	test('requires a WG member for dashboard API data', async ({ request }) => {
		const response = await request.get('/api/wg/MTE8PZAT/dashboard', {
			timeout: 120_000,
		});

		expect(response.status()).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ error: 'member_id_required' });
	});

	test('lets users retry after the dashboard request fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let failDashboard = true;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/dashboard', async (route) => {
			if (failDashboard) {
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
				body: JSON.stringify(dashboardResponseBody()),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT');
		await expect(
			page.getByText('Dashboard konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeVisible({
			timeout: 30_000,
		});

		failDashboard = false;
		await page.getByRole('button', { name: 'Dashboard erneut laden' }).click();

		await expect(page.getByRole('link', { name: 'Einkauf offen 1 Hafermilch' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			page.getByText('Dashboard konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeHidden();
	});

	test('explains stale membership when dashboard loading is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/dashboard', async (route) => {
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT');

		await expect(
			page.getByText('Dashboard konnte nicht geladen werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Dashboard konnte nicht geladen werden.')).toHaveCount(0);
	});

	test('does not show setup onboarding links on the dashboard', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/dashboard', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					dashboardResponseBody({
						setup: {
							choreCount: 1,
							hasExpense: false,
							hasShoppingItem: false,
							hasAnnouncement: false,
							notificationsEnabled: true,
						},
					}),
				),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT');

		await expect(page.getByText('Erster Tag')).toHaveCount(0);
		await expect(page.getByText('Nächster Schritt')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Erste WG-Sache eintragen' })).toHaveCount(0);
	});

	test('keeps the empty wg dashboard focused without verbose setup paths', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/dashboard', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					dashboardResponseBody({
						openShoppingCount: 0,
						openShoppingTop: [],
						balances: [],
						totalSpendCents: 0,
						weekSpendCents: 0,
						monthSpendCents: 0,
						setup: {
							choreCount: 0,
							hasExpense: false,
							hasShoppingItem: false,
							hasAnnouncement: false,
							notificationsEnabled: false,
						},
					}),
				),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT');

		await expect(page.getByText('Nächster Schritt')).toHaveCount(0);
		await expect(page.getByText('WG einrichten')).toHaveCount(0);
		await expect(page.getByText('Erster Tag')).toHaveCount(0);
		await expect(page.getByText('WG startklar machen')).toHaveCount(0);
		await expect(page.getByText('Startpfade')).toHaveCount(0);
		await expect(page.getByText('Beispiel-Vorschau')).toHaveCount(0);
	});
});
