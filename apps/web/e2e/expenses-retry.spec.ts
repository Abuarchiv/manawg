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

async function delay(ms: number) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function openRecordedExpenses(page: Page): Promise<void> {
	const summary = page.getByText('Eingetragene Ausgaben', { exact: true });
	await expect(summary).toBeVisible({ timeout: 30_000 });
	await summary.click();
}

async function openRecurringExpenses(page: Page): Promise<void> {
	const summary = page.getByText('Wiederkehrende Kosten', { exact: true });
	await expect(summary).toBeVisible({ timeout: 30_000 });
	await summary.click();
}

test.describe('Expenses recovery', () => {
	test.setTimeout(300_000);

	test('requires a WG member for expenses and recurring API data', async ({ request }) => {
		const [expensesResponse, recurringResponse] = await Promise.all([
			request.get('/api/wg/MTE8PZAT/expenses', { timeout: 120_000 }),
			request.get('/api/wg/MTE8PZAT/recurring-expenses', { timeout: 120_000 }),
		]);

		expect(expensesResponse.status()).toBe(401);
		expect(recurringResponse.status()).toBe(401);
		await expect(expensesResponse.json()).resolves.toMatchObject({
			error: 'member_id_required',
		});
		await expect(recurringResponse.json()).resolves.toMatchObject({
			error: 'member_id_required',
		});
	});

	test('shows a retryable load error instead of an empty expenses list', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let failExpenses = true;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (failExpenses) {
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
					expenses: [
						{
							id: 'expense-1',
							paidByMemberId: memberId,
							amountCents: 1299,
							currency: 'EUR',
							description: 'Spülmittel',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');

		await expect(
			page.getByText('Ausgaben konnten nicht geladen werden: Versuche es gleich erneut.'),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText('Noch keine Ausgaben.')).toBeHidden();

		failExpenses = false;
		await page.getByRole('button', { name: 'Ausgaben erneut laden' }).click();

		await page.getByText('Eingetragene Ausgaben', { exact: true }).click();
		await expect(page.getByText('Spülmittel')).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByText('Ausgaben konnten nicht geladen werden: Versuche es gleich erneut.'),
		).toBeHidden();
	});

	test('explains network failures while loading expenses', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.abort('failed');
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');

		await expect(
			page.getByText(
				'Ausgaben konnten nicht geladen werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Ausgaben konnten nicht geladen werden.')).toHaveCount(0);
	});

	test('explains stale membership when expenses load is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');

		await expect(
			page.getByText('Ausgaben konnten nicht geladen werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Ausgaben konnten nicht geladen werden.')).toHaveCount(0);
	});

	test('uses expense-specific action labels for repeated rows', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: [
						{
							id: 'expense-milk',
							paidByMemberId: memberId,
							amountCents: 399,
							currency: 'EUR',
							description: 'Milch',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [],
						},
						{
							id: 'expense-bread',
							paidByMemberId: memberId,
							amountCents: 249,
							currency: 'EUR',
							description: 'Brot',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);

		await expect(page.getByRole('button', { name: 'Ausgabe bearbeiten: Milch' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: 'Ausgabe bearbeiten: Brot' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Ausgabe entfernen: Milch' })).toBeVisible();
		await page.getByRole('button', { name: 'Ausgabe entfernen: Brot' }).click();
		await expect(
			page.getByRole('button', { name: 'Ausgabe entfernen bestätigen: Brot' }),
		).toBeVisible();
	});

	test('removes deleted expenses after a successful delete', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/expenses(?:\/|\?|$)/, async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/expense-delete')) {
				deleted = true;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: deleted
						? []
						: [
								{
									id: 'expense-delete',
									paidByMemberId: memberId,
									amountCents: 399,
									currency: 'EUR',
									description: 'Milch',
									imageUrl: null,
									occurredAt: new Date().toISOString(),
									createdAt: new Date().toISOString(),
									updatedAt: new Date().toISOString(),
									splits: [],
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);
		await expect(page.getByRole('button', { name: 'Ausgabe entfernen: Milch' })).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Ausgabe entfernen: Milch' }).click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Ausgabe entfernen bestätigen: Milch' })
			.click({ timeout: 5000 });

		await expect(page.getByRole('button', { name: 'Ausgabe entfernen: Milch' })).toBeHidden({
			timeout: 5000,
		});
	});

	test('removes stale expenses when deleting finds them already gone', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/expenses(?:\/|\?|$)/, async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/expense-stale-delete')) {
				deleted = true;
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'expense_not_found' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: deleted
						? []
						: [
								{
									id: 'expense-stale-delete',
									paidByMemberId: memberId,
									amountCents: 399,
									currency: 'EUR',
									description: 'Milch',
									imageUrl: null,
									occurredAt: new Date().toISOString(),
									createdAt: new Date().toISOString(),
									updatedAt: new Date().toISOString(),
									splits: [],
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);
		await expect(page.getByRole('button', { name: 'Ausgabe entfernen: Milch' })).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Ausgabe entfernen: Milch' }).click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Ausgabe entfernen bestätigen: Milch' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Diese Ausgabe existiert nicht mehr und wurde aus der Liste entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('expense_not_found')).toBeHidden();
		await expect(page.getByRole('button', { name: 'Ausgabe entfernen: Milch' })).toBeHidden({
			timeout: 5000,
		});
	});

	test('explains invalid expense deletes without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/expenses(?:\/|\?|$)/, async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/expense-invalid-delete')) {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'id_invalid' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: [
						{
							id: 'expense-invalid-delete',
							paidByMemberId: memberId,
							amountCents: 399,
							currency: 'EUR',
							description: 'Milch',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);
		await expect(page.getByRole('button', { name: 'Ausgabe entfernen: Milch' })).toBeVisible({
			timeout: 30_000,
		});
		await page.getByRole('button', { name: 'Ausgabe entfernen: Milch' }).click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Ausgabe entfernen bestätigen: Milch' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Diese Ausgabenaktion konnte nicht eindeutig zugeordnet werden.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('id_invalid')).toBeHidden();
		await expect(page.getByRole('button', { name: 'Ausgabe entfernen: Milch' })).toBeVisible();
	});

	test('explains network failures when deleting an expense fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/expenses(?:\/|\?|$)/, async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/expense-network-delete')) {
				await route.abort('failed');
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: [
						{
							id: 'expense-network-delete',
							paidByMemberId: memberId,
							amountCents: 399,
							currency: 'EUR',
							description: 'Milch',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);
		await expect(page.getByRole('button', { name: 'Ausgabe entfernen: Milch' })).toBeVisible({
			timeout: 30_000,
		});
		await page.getByRole('button', { name: 'Ausgabe entfernen: Milch' }).click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Ausgabe entfernen bestätigen: Milch' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText(
				'Ausgabenaktion fehlgeschlagen: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Ausgabenaktion fehlgeschlagen.')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Ausgabe entfernen: Milch' })).toBeVisible();
	});

	test('removes stale expenses when saving an edit finds them already gone', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let deleted = false;
		let expenseCreates = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/expenses(?:\/|\?|$)/, async (route) => {
			const request = route.request();
			if (request.method() === 'POST') {
				expenseCreates += 1;
				await route.fulfill({ status: 500, json: { error: 'unexpected_create' } });
				return;
			}
			if (request.method() === 'PATCH' && request.url().endsWith('/expense-stale-edit')) {
				deleted = true;
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'expense_not_found' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: deleted
						? []
						: [
								{
									id: 'expense-stale-edit',
									paidByMemberId: memberId,
									amountCents: 399,
									currency: 'EUR',
									description: 'Milch',
									imageUrl: null,
									occurredAt: new Date().toISOString(),
									createdAt: new Date().toISOString(),
									updatedAt: new Date().toISOString(),
									splits: [],
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);
		await expect(page.getByRole('button', { name: 'Ausgabe bearbeiten: Milch' })).toBeVisible({
			timeout: 30_000,
		});
		await page.getByRole('button', { name: 'Ausgabe bearbeiten: Milch' }).click();
		await page.getByLabel('Beschreibung').fill('Milch und Brot');
		await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

		await expect(
			page.getByText('Diese Ausgabe existiert nicht mehr und wurde aus der Liste entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('expense_not_found')).toBeHidden();
		await expect(page.getByRole('button', { name: 'Ausgabe bearbeiten: Milch' })).toBeHidden({
			timeout: 5000,
		});
		await expect(page.getByLabel('Beschreibung')).toHaveValue('Milch und Brot');
		expect(expenseCreates).toBe(0);
		await page.reload();
		await expect(page.getByLabel('Beschreibung')).toHaveValue('Milch und Brot');
		await page.getByRole('button', { name: 'Ausgabe speichern' }).click();
		await expect(
			page.getByText('Diese Ausgabe existiert nicht mehr und wurde aus der Liste entfernt.'),
		).toBeVisible();
		expect(expenseCreates).toBe(0);
	});

	test('updates split settlement after a successful toggle', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let settledAt: string | null = null;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/expenses(?:\/|\?|$)/, async (route) => {
			const request = route.request();
			if (request.method() === 'POST' && request.url().endsWith('/split-1/settle')) {
				settledAt = new Date().toISOString();
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: [
						{
							id: 'expense-settle',
							paidByMemberId: memberId,
							amountCents: 399,
							currency: 'EUR',
							description: 'Milch',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [
								{
									id: 'split-1',
									debtorMemberId: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
									amountCents: 399,
									settledAt,
								},
							],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);
		await expect(page.getByText('0/1 beglichen')).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: /Milch\s+3,99/ }).click();

		await page
			.getByRole('button', { name: /Zahlung als beglichen markieren/ })
			.click({ timeout: 5000 });

		await expect(page.getByText('1/1 beglichen')).toBeVisible({ timeout: 5000 });
		await expect(page.getByRole('button', { name: /Zahlung als offen markieren/ })).toBeVisible({
			timeout: 5000,
		});
	});

	test('explains stale split settlement failures and refreshes expenses', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let expenseDeleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/expenses(?:\/|\?|$)/, async (route) => {
			const request = route.request();
			if (request.method() === 'POST' && request.url().endsWith('/split-stale/settle')) {
				expenseDeleted = true;
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'split_not_found' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: expenseDeleted
						? []
						: [
								{
									id: 'expense-stale-settle',
									paidByMemberId: memberId,
									amountCents: 399,
									currency: 'EUR',
									description: 'Milch',
									imageUrl: null,
									occurredAt: new Date().toISOString(),
									createdAt: new Date().toISOString(),
									updatedAt: new Date().toISOString(),
									splits: [
										{
											id: 'split-stale',
											debtorMemberId: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
											amountCents: 399,
											settledAt: null,
										},
									],
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);
		await expect(page.getByText('0/1 beglichen')).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: /Milch\s+3,99/ }).click();

		await page
			.getByRole('button', { name: /Zahlung als beglichen markieren/ })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Diese Zahlung existiert nicht mehr. Die Ausgabenliste wird aktualisiert.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('split_not_found')).toBeHidden();
		await expect(page.getByText('Milch')).toBeHidden({ timeout: 5000 });
	});

	test('explains forbidden split settlement without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const payerId = '11111111-1111-4111-8111-111111111111';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/expenses(?:\/|\?|$)/, async (route) => {
			const request = route.request();
			if (request.method() === 'POST' && request.url().endsWith('/split-forbidden/settle')) {
				await route.fulfill({
					status: 403,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'not_split_party' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: [
						{
							id: 'expense-forbidden-settle',
							paidByMemberId: payerId,
							amountCents: 399,
							currency: 'EUR',
							description: 'Milch',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [
								{
									id: 'split-forbidden',
									debtorMemberId: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
									amountCents: 399,
									settledAt: null,
								},
							],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);
		await expect(page.getByText('0/1 beglichen')).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: /Milch\s+3,99/ }).click();
		await page
			.getByRole('button', { name: /Zahlung als beglichen markieren/ })
			.click({ timeout: 5000 });

		await expect(
			page.getByText(
				'Nur Zahler:in oder beteiligte Person kann diese Zahlung als beglichen markieren.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('not_split_party')).toBeHidden();
	});

	test('explains invalid split settlement requests without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const payerId = '11111111-1111-4111-8111-111111111111';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/expenses(?:\/|\?|$)/, async (route) => {
			const request = route.request();
			if (request.method() === 'POST' && request.url().endsWith('/split-invalid/settle')) {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'invalid_body' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					expenses: [
						{
							id: 'expense-invalid-settle',
							paidByMemberId: payerId,
							amountCents: 399,
							currency: 'EUR',
							description: 'Milch',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [
								{
									id: 'split-invalid',
									debtorMemberId: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
									amountCents: 399,
									settledAt: null,
								},
							],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecordedExpenses(page);
		await expect(page.getByText('0/1 beglichen')).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: /Milch\s+3,99/ }).click();
		await page
			.getByRole('button', { name: /Zahlung als beglichen markieren/ })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Ausgabenaktion konnte nicht gespeichert werden: Die Anfrage war ungültig.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Ausgabenaktion fehlgeschlagen.')).toHaveCount(0);
		await expect(page.getByText('invalid_body')).toBeHidden();
	});

	test('shows newly saved expenses before a background refresh finishes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let getRequests = 0;

		const savedExpense = {
			id: 'expense-created-now',
			paidByMemberId: memberId,
			amountCents: 1299,
			currency: 'EUR',
			description: 'Frischer Einkauf',
			imageUrl: null,
			occurredAt: new Date().toISOString(),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			splits: [],
		};

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			const request = route.request();
			if (request.method() === 'POST') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ expense: savedExpense }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			getRequests += 1;
			if (getRequests > 1) await delay(3000);
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: getRequests > 1 ? [savedExpense] : [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
		await page.getByLabel('Beschreibung').fill('Frischer Einkauf');
		await page.getByLabel('Betrag').fill('12,99');

		await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

		await openRecordedExpenses(page);
		await expect(page.getByText('Frischer Einkauf')).toBeVisible({ timeout: 1000 });
	});

	test('explains expense split validation errors without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			const request = route.request();
			if (request.method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'splits_invalid' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
		await page.getByLabel('Beschreibung').fill('Frischer Einkauf');
		await page.getByLabel('Betrag').fill('12,99');
		await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

		await expect(
			page.getByText(
				'Beträge stimmen nicht überein — Summe muss exakt dem Gesamtbetrag entsprechen.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('splits_invalid')).toBeHidden();
	});

	test('restores amount-only expense drafts by opening the form', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					`manawg:draft:MTE8PZAT:${memberId}:expense`,
					JSON.stringify({ amountStr: '7,50', splitMode: 'equal' }),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');

		await expect(page.locator('#f-betrag')).toHaveValue('7,50', { timeout: 30_000 });
		await expect(page.locator('#f-beschreibung')).toBeVisible();
	});

	test('prefills the expense form from empty-list templates', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');

		await expect(
			page.getByText('Leg die erste Ausgabe an oder starte mit einer typischen WG-Ausgabe.'),
		).toBeVisible({
			timeout: 30_000,
		});
		await page.getByRole('button', { name: 'Wocheneinkauf' }).click();

		await expect(page.locator('#f-beschreibung')).toHaveValue('Wocheneinkauf');
		await expect(page.locator('#f-betrag')).toHaveValue('25,00');
		await expect(page.locator('#f-beschreibung')).toBeFocused();
	});

	test('keeps expense form actions disabled while saving', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let releasePost: (() => void) | null = null;
		let createdExpense: {
			id: string;
			paidByMemberId: string;
			amountCents: number;
			currency: string;
			description: string;
			imageUrl: null;
			occurredAt: string;
			createdAt: string;
			updatedAt: string;
			splits: never[];
		} | null = null;
		const postCanFinish = new Promise<void>((resolve) => {
			releasePost = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await postCanFinish;
				const now = new Date().toISOString();
				createdExpense = {
					id: 'expense-saving-lock',
					paidByMemberId: memberId,
					amountCents: 1299,
					currency: 'EUR',
					description: 'Spülmittel',
					imageUrl: null,
					occurredAt: now,
					createdAt: now,
					updatedAt: now,
					splits: [],
				};
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ expense: createdExpense }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: createdExpense ? [createdExpense] : [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
		await page.getByLabel('Beschreibung').fill('Spülmittel');
		await page.getByLabel('Betrag').fill('12,99');
		await page.getByRole('button', { name: 'Fixkosten-Vorlage' }).click();
		await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

		await expect(page.getByRole('button', { name: 'Ausgabe speichern' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Ausgabe abbrechen' })).toBeDisabled();
		await expect(page.getByLabel('Beschreibung')).toBeDisabled();
		await expect(page.getByLabel('Betrag')).toBeDisabled();
		await expect(page.getByLabel('Bezahlt von')).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Aufteilung: Manuell' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Quartal' })).toBeDisabled();
		await expect(page.getByLabel('Bild auswählen')).toBeDisabled();

		releasePost?.();
		await openRecordedExpenses(page);
		await expect(page.getByText('Spülmittel')).toBeVisible({ timeout: 30_000 });
	});

	test('explains stale membership when saving an expense is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
		await page.getByLabel('Beschreibung').fill('Spülmittel');
		await page.getByLabel('Betrag').fill('12,99');
		await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

		await expect(
			page.getByText('Ausgabe konnte nicht gespeichert werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Ausgabe konnte nicht gespeichert werden.')).toHaveCount(0);
	});

	test('explains server failures when saving an expense fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
		await page.getByLabel('Beschreibung').fill('Spülmittel');
		await page.getByLabel('Betrag').fill('12,99');
		await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

		await expect(
			page.getByText('Ausgabe konnte nicht gespeichert werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Ausgabe konnte nicht gespeichert werden.')).toHaveCount(0);
		await expect(page.getByLabel('Beschreibung')).toHaveValue('Spülmittel');
	});

	test('explains invalid requests when saving an expense fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'invalid_body' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
		await page.getByLabel('Beschreibung').fill('Spülmittel');
		await page.getByLabel('Betrag').fill('12,99');
		await page.getByRole('button', { name: 'Ausgabe speichern' }).click();

		await expect(
			page.getByText('Ausgabe konnte nicht gespeichert werden: Die Anfrage war ungültig.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Ausgabe konnte nicht gespeichert werden.')).toHaveCount(0);
		await expect(page.getByText('invalid_body')).toBeHidden();
		await expect(page.getByLabel('Beschreibung')).toHaveValue('Spülmittel');
	});

	test('explains recurring template save validation errors', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'member_not_in_wg' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
		await page.getByLabel('Beschreibung').fill('Internet');
		await page.getByLabel('Betrag').fill('35,00');
		await page.getByRole('button', { name: 'Fixkosten-Vorlage' }).click();
		await page.getByRole('button', { name: 'Als Vorlage merken' }).click();

		await expect(
			page.getByText('Mindestens ein Mitglied der Fixkosten-Vorlage ist nicht mehr in dieser WG.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Vorlage konnte nicht gespeichert werden.')).toBeHidden();
	});

	test('explains server failures when saving a recurring template fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
		await page.getByLabel('Beschreibung').fill('Internet');
		await page.getByLabel('Betrag').fill('35,00');
		await page.getByRole('button', { name: 'Fixkosten-Vorlage' }).click();
		await page.getByRole('button', { name: 'Als Vorlage merken' }).click();

		await expect(
			page.getByText('Vorlage konnte nicht gespeichert werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Vorlage konnte nicht gespeichert werden.')).toHaveCount(0);
		await expect(page.getByLabel('Beschreibung')).toHaveValue('Internet');
	});

	test('explains invalid requests when saving a recurring template fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'invalid_body' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
		await page.getByLabel('Beschreibung').fill('Internet');
		await page.getByLabel('Betrag').fill('35,00');
		await page.getByRole('button', { name: 'Fixkosten-Vorlage' }).click();
		await page.getByRole('button', { name: 'Als Vorlage merken' }).click();

		await expect(
			page.getByText('Vorlage konnte nicht gespeichert werden: Die Anfrage war ungültig.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Vorlage konnte nicht gespeichert werden.')).toHaveCount(0);
		await expect(page.getByText('invalid_body')).toBeHidden();
		await expect(page.getByLabel('Beschreibung')).toHaveValue('Internet');
	});

	test('warns when a recurring expense is created but the template cannot be advanced', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const recurringId = 'recurring-e2e-advance-fails';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						expense: {
							id: 'expense-from-recurring',
							paidByMemberId: memberId,
							amountCents: 3290,
							currency: 'EUR',
							description: 'Internet',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [],
						},
					}),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'advance_failed' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: [
						{
							id: recurringId,
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');

		const recurringCard = page.locator(`#recurring-${recurringId}`);
		await expect(recurringCard.getByText('Internet')).toBeVisible({ timeout: 30_000 });
		await recurringCard
			.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Internet' })
			.click();

		await expect(
			page.getByText(
				'Ausgabe wurde erstellt, aber die Fixkosten-Vorlage konnte nicht weitergeschoben werden. Prüfe sie später noch einmal.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole('status').filter({
				hasText:
					'Ausgabe wurde erstellt, aber die Fixkosten-Vorlage konnte nicht weitergeschoben werden.',
			}),
		).toBeVisible();
		await expect(
			page.getByRole('alert').filter({
				hasText:
					'Ausgabe wurde erstellt, aber die Fixkosten-Vorlage konnte nicht weitergeschoben werden.',
			}),
		).toHaveCount(0);
		await expect(page.locator(`#recurring-${recurringId}`)).toBeVisible();
	});

	test('shows recurring-created expenses before a background refresh finishes', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const recurringId = 'recurring-e2e-immediate-create';
		const dueAt = new Date(Date.now() - 86_400_000).toISOString();
		const createdExpense = {
			id: 'expense-from-recurring-immediate',
			paidByMemberId: memberId,
			amountCents: 3290,
			currency: 'EUR',
			description: 'Internet',
			imageUrl: null,
			occurredAt: new Date().toISOString(),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			splits: [],
		};
		let expenseGets = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ expense: createdExpense }),
				});
				return;
			}
			expenseGets += 1;
			if (expenseGets > 1) {
				await delay(5000);
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: expenseGets > 1 ? [createdExpense] : [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						recurringExpense: {
							id: recurringId,
							wgId,
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Internet',
							amountCents: 3290,
							intervalMonths: 1,
							nextDueAt: new Date(Date.now() + 86_400_000).toISOString(),
							lastCreatedAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							splits: [{ debtorMemberId: memberId, amountCents: 3290 }],
						},
					}),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: [
						{
							id: recurringId,
							wgId,
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Internet',
							amountCents: 3290,
							intervalMonths: 1,
							nextDueAt: dueAt,
							lastCreatedAt: null,
							createdAt: new Date().toISOString(),
							splits: [{ debtorMemberId: memberId, amountCents: 3290 }],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');
		await page
			.locator(`#recurring-${recurringId}`)
			.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Internet' })
			.click();

		await openRecordedExpenses(page);
		await expect(page.locator('#expense-expense-from-recurring-immediate')).toBeVisible({
			timeout: 1000,
		});
	});

	test('explains when a recurring template was already advanced elsewhere', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const recurringId = 'recurring-e2e-conflict';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						expense: {
							id: 'expense-from-recurring-conflict',
							paidByMemberId: memberId,
							amountCents: 3290,
							currency: 'EUR',
							description: 'Internet',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [],
						},
					}),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 409,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'recurring_expense_already_advanced' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: [
						{
							id: recurringId,
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');

		const recurringCard = page.locator(`#recurring-${recurringId}`);
		await expect(recurringCard.getByText('Internet')).toBeVisible({ timeout: 30_000 });
		await recurringCard
			.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Internet' })
			.click();

		await expect(
			page.getByRole('status').filter({
				hasText:
					'Ausgabe wurde erstellt, aber die Vorlage war schon weitergeschoben. Prüfe kurz, ob diese Fixkosten doppelt übernommen wurden.',
			}),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole('alert').filter({
				hasText: 'Vorlage war schon weitergeschoben',
			}),
		).toHaveCount(0);
	});

	test('does not create duplicate expenses from rapid recurring quick-create clicks', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueAt = new Date(Date.now() - 86_400_000).toISOString();
		let expensePosts = 0;
		const advanceBodies: unknown[] = [];
		let releaseExpensePost: (() => void) | null = null;
		const expensePostCanFinish = new Promise<void>((resolve) => {
			releaseExpensePost = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				expensePosts += 1;
				await expensePostCanFinish;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						expense: {
							id: 'expense-from-recurring',
							paidByMemberId: memberId,
							amountCents: 3290,
							currency: 'EUR',
							description: 'Internet',
							imageUrl: null,
							occurredAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							splits: [],
						},
					}),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'PATCH') {
				advanceBodies.push(route.request().postDataJSON());
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						recurringExpense: {
							id: 'recurring-e2e-single-create',
							wgId,
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Internet',
							amountCents: 3290,
							intervalMonths: 1,
							nextDueAt: new Date(Date.now() + 86_400_000).toISOString(),
							lastCreatedAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
							splits: [{ debtorMemberId: memberId, amountCents: 3290 }],
						},
					}),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: [
						{
							id: 'recurring-e2e-single-create',
							wgId,
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Internet',
							amountCents: 3290,
							intervalMonths: 1,
							nextDueAt: dueAt,
							lastCreatedAt: null,
							createdAt: new Date().toISOString(),
							splits: [{ debtorMemberId: memberId, amountCents: 3290 }],
						},
						{
							id: 'recurring-e2e-second-create',
							wgId,
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Strom',
							amountCents: 4800,
							intervalMonths: 1,
							nextDueAt: dueAt,
							lastCreatedAt: null,
							createdAt: new Date().toISOString(),
							splits: [{ debtorMemberId: memberId, amountCents: 4800 }],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');
		const quickCreate = page.getByRole('button', {
			name: 'Fixkosten-Ausgabe direkt erstellen: Internet',
		});
		await expect(quickCreate.first()).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Strom' }),
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Internet' }),
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Strom' }),
		).toBeVisible();

		await quickCreate.first().evaluate((button) => {
			button.click();
			button.click();
		});

		await expect.poll(() => expensePosts).toBe(1);
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Strom' }),
		).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Internet' }),
		).toBeDisabled();
		await expect(
			page.getByRole('link', { name: 'Fixkosten-Ausgabe manuell erfassen: Internet' }),
		).toHaveAttribute('aria-disabled', 'true');
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage löschen: Internet' }),
		).toBeDisabled();
		releaseExpensePost?.();
		await expect
			.poll(() => advanceBodies)
			.toEqual([{ id: 'recurring-e2e-single-create', expectedNextDueAt: dueAt }]);
	});

	test('shows every recurring template in recurring focus mode', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueAt = new Date(Date.now() + 86_400_000).toISOString();
		const descriptions = ['Internet', 'Strom', 'Gas', 'Versicherung', 'Rundfunk'];

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: descriptions.map((description, index) => ({
						id: `recurring-e2e-focus-${index}`,
						wgId,
						createdByMemberId: memberId,
						paidByMemberId: memberId,
						description,
						amountCents: 1000 + index,
						intervalMonths: 1,
						nextDueAt: dueAt,
						lastCreatedAt: null,
						createdAt: new Date().toISOString(),
						splits: [{ debtorMemberId: memberId, amountCents: 1000 + index }],
					})),
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben');
		await openRecurringExpenses(page);

		await expect(page.getByRole('link', { name: 'Alle 5 Fixkosten anzeigen' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Rundfunk' }),
		).toBeHidden();

		await page.getByRole('link', { name: 'Alle 5 Fixkosten anzeigen' }).click();

		await expect(page.getByText('Fixkosten-Fokus')).toBeVisible({ timeout: 30_000 });
		for (const description of descriptions) {
			await expect(
				page.getByRole('button', { name: `Fixkosten-Vorlage bearbeiten: ${description}` }),
			).toBeVisible();
		}
	});

	test('removes stale recurring templates when saving an edit finds them gone', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const recurringId = 'recurring-e2e-stale-edit';
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'PATCH') {
				deleted = true;
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'recurring_expense_not_found' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: deleted
						? []
						: [
								{
									id: recurringId,
									wgId,
									createdByMemberId: memberId,
									paidByMemberId: memberId,
									description: 'Internet',
									amountCents: 3500,
									intervalMonths: 1,
									nextDueAt: new Date(Date.now() + 86_400_000).toISOString(),
									lastCreatedAt: null,
									createdAt: new Date().toISOString(),
									splits: [{ debtorMemberId: memberId, amountCents: 3500 }],
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Internet' }),
		).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Internet' }).click();
		await page.getByLabel('Beschreibung').fill('Internet neu');
		await page.getByRole('button', { name: 'Vorlage speichern' }).click();

		await expect(
			page.getByText(
				'Diese Fixkosten-Vorlage existiert nicht mehr und wurde aus der Liste entfernt.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('recurring_expense_not_found')).toBeHidden();
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Internet' }),
		).toBeHidden({ timeout: 5000 });
		await expect(page.getByLabel('Beschreibung')).toBeHidden();
	});

	test('deletes a recurring template from the recurring focus list', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const recurringId = 'recurring-e2e-delete';
		let deleted = false;
		let deleteRequests = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'DELETE') {
				deleteRequests += 1;
				expect(route.request().postDataJSON()).toEqual({ id: recurringId });
				deleted = true;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ deleted: true }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: deleted
						? []
						: [
								{
									id: recurringId,
									wgId,
									createdByMemberId: memberId,
									paidByMemberId: memberId,
									description: 'Internet',
									amountCents: 3500,
									intervalMonths: 1,
									nextDueAt: new Date(Date.now() + 86_400_000).toISOString(),
									lastCreatedAt: null,
									createdAt: new Date().toISOString(),
									splits: [{ debtorMemberId: memberId, amountCents: 3500 }],
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage löschen: Internet' }),
		).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'Fixkosten-Vorlage löschen: Internet' }).click();
		await page
			.getByRole('button', { name: 'Fixkosten-Vorlage wirklich löschen: Internet' })
			.click();

		await expect.poll(() => deleteRequests).toBe(1);
		await expect(page.getByText('Fixkosten-Vorlage gelöscht.')).toBeVisible({ timeout: 5000 });
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Internet' }),
		).toBeHidden({ timeout: 5000 });
	});

	test('explains network failures when deleting a recurring template fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const recurringId = 'recurring-e2e-delete-network';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'DELETE') {
				await route.abort('failed');
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: [
						{
							id: recurringId,
							wgId,
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Internet',
							amountCents: 3500,
							intervalMonths: 1,
							nextDueAt: new Date(Date.now() + 86_400_000).toISOString(),
							lastCreatedAt: null,
							createdAt: new Date().toISOString(),
							splits: [{ debtorMemberId: memberId, amountCents: 3500 }],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage löschen: Internet' }),
		).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'Fixkosten-Vorlage löschen: Internet' }).click();
		await page
			.getByRole('button', { name: 'Fixkosten-Vorlage wirklich löschen: Internet' })
			.click();

		await expect(
			page.getByText(
				'Vorlage konnte nicht gelöscht werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Vorlage konnte nicht gelöscht werden.')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Internet' }),
		).toBeVisible();
	});

	test('queues a recurring quick-create expense when the network is offline', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.abort('failed');
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: [
						{
							id: 'recurring-e2e-offline',
							wgId,
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Strom',
							amountCents: 4800,
							intervalMonths: 1,
							nextDueAt: new Date(Date.now() - 86_400_000).toISOString(),
							lastCreatedAt: null,
							createdAt: new Date().toISOString(),
							splits: [{ debtorMemberId: memberId, amountCents: 4800 }],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');

		await page.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Strom' }).click();

		await expect(
			page.getByText(
				'Fixkosten-Ausgabe offline vorgemerkt. Die Vorlage bleibt bis zur Synchronisierung unverändert.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole('status').filter({
				hasText: 'Fixkosten-Ausgabe offline vorgemerkt.',
			}),
		).toBeVisible();
		await expect(
			page.getByRole('link', { name: '1 Offline-Aktion wartet auf Synchronisierung.' }),
		).toBeVisible();
		await expect(
			page.getByRole('status').filter({
				hasText: /^1 Offline-Aktion wartet auf Synchronisierung\.$/,
			}),
		).toBeVisible();
	});

	test('explains server failures when quick-creating a recurring expense fails', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ expenses: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					recurringExpenses: [
						{
							id: 'recurring-e2e-server-fail',
							wgId,
							createdByMemberId: memberId,
							paidByMemberId: memberId,
							description: 'Strom',
							amountCents: 4800,
							intervalMonths: 1,
							nextDueAt: new Date(Date.now() - 86_400_000).toISOString(),
							lastCreatedAt: null,
							createdAt: new Date().toISOString(),
							splits: [{ debtorMemberId: memberId, amountCents: 4800 }],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/ausgaben?filter=recurring');

		await page.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Strom' }).click();

		await expect(
			page.getByText('Fixkosten-Ausgabe konnte nicht erstellt werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Fixkosten-Ausgabe konnte nicht erstellt werden.')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Strom' }),
		).toBeVisible();
	});
});
