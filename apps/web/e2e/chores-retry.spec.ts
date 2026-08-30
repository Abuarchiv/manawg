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

test.describe('Chores recovery', () => {
	test.setTimeout(300_000);

	test('requires a WG member for chores and absences API data', async ({ request }) => {
		const [choresResponse, absencesResponse] = await Promise.all([
			request.get('/api/wg/MTE8PZAT/chores', { timeout: 120_000 }),
			request.get('/api/wg/MTE8PZAT/absences', { timeout: 120_000 }),
		]);

		expect(choresResponse.status()).toBe(401);
		expect(absencesResponse.status()).toBe(401);
		await expect(choresResponse.json()).resolves.toMatchObject({ error: 'member_id_required' });
		await expect(absencesResponse.json()).resolves.toMatchObject({
			error: 'member_id_required',
		});
	});

	test('restores non-title chore drafts by opening the form', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:draft:MTE8PZAT:chore',
					JSON.stringify({ title: '', intervalDays: 14, assignedMemberId: memberId }),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');

		await expect(page.locator('#chore-title')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'alle 14 T.' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.locator('#chore-assigned')).toHaveValue(memberId);
	});

	test('shows a retryable load error instead of an empty chore plan', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let failChores = true;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.removeItem('manawg:offline-actions');
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			if (failChores) {
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
					chores: [
						{
							id: 'chore-1',
							title: 'Bad putzen',
							intervalDays: 7,
							nextDueAt: new Date().toISOString(),
							assignedMemberId: memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');

		await expect(
			page.getByText('Putzplan konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText('Noch kein Putzplan.')).toBeHidden();

		failChores = false;
		await page.getByRole('button', { name: 'Putzplan erneut laden' }).click();

		await expect(page.getByText('Bad putzen')).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByText('Putzplan konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeHidden();
	});

	test('explains stale membership when chore plan load is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');

		await expect(
			page.getByText('Putzplan konnte nicht geladen werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Putzplan konnte nicht geladen werden.')).toHaveCount(0);
	});

	test('uses chore-specific action labels for repeated rows', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const overdueDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
		const upcomingDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-bath',
							title: 'Bad putzen',
							intervalDays: 7,
							nextDueAt: overdueDate,
							assignedMemberId: memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
						{
							id: 'chore-kitchen',
							title: 'Küche wischen',
							intervalDays: 7,
							nextDueAt: upcomingDate,
							assignedMemberId: memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');

		await expect(page.getByRole('button', { name: 'Tausch anfragen: Bad putzen' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			page.getByRole('button', { name: 'Überfällige Aufgabe nachholen: Bad putzen' }),
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Aufgabe übernehmen: Bad putzen' }),
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Als erledigt markieren: Küche wischen' }),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Aufgabe entfernen: Bad putzen' })).toBeVisible();
		await page.getByRole('button', { name: 'Aufgabe entfernen: Küche wischen' }).click();
		await expect(
			page.getByRole('button', { name: 'Aufgabe entfernen bestätigen: Küche wischen' }),
		).toBeVisible();
	});

	test('removes deleted chores after a successful delete', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/chore-delete')) {
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
					chores: deleted
						? []
						: [
								{
									id: 'chore-delete',
									title: 'Küche wischen',
									intervalDays: 7,
									nextDueAt: dueDate,
									assignedMemberId: memberId,
									lastCompletedAt: null,
									lastCompletedByName: null,
									openGapCountForAssignee: 0,
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(
			page.getByRole('button', { name: 'Aufgabe entfernen: Küche wischen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Aufgabe entfernen: Küche wischen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Aufgabe entfernen bestätigen: Küche wischen' })
			.click({ timeout: 5000 });

		await expect(page.getByRole('button', { name: 'Aufgabe entfernen: Küche wischen' })).toBeHidden(
			{ timeout: 5000 },
		);
	});

	test('updates completed chores after a successful completion', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();
		let completedAt: string | null = null;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (request.method() === 'POST' && request.url().endsWith('/chore-complete/complete')) {
				completedAt = new Date().toISOString();
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
					chores: [
						{
							id: 'chore-complete',
							title: 'Küche wischen',
							intervalDays: 7,
							nextDueAt: completedAt
								? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
								: dueDate,
							assignedMemberId: memberId,
							lastCompletedAt: completedAt,
							lastCompletedByName: completedAt ? 'dsaf' : null,
							openGapCountForAssignee: completedAt ? 0 : 1,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(page.getByText('Noch kein Verlauf')).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Als erledigt markieren: Küche wischen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Erledigt bestätigen: Küche wischen' })
			.click({ timeout: 5000 });

		await expect(page.getByText('Zuletzt gerade eben von dsaf')).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('1 offene Lücke')).toHaveCount(0);
	});

	test('removes stale chores when completion finds them deleted', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (request.method() === 'POST' && request.url().endsWith('/chore-stale-complete/complete')) {
				deleted = true;
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'chore_not_found' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: deleted
						? []
						: [
								{
									id: 'chore-stale-complete',
									title: 'Bad putzen',
									intervalDays: 7,
									nextDueAt: dueDate,
									assignedMemberId: memberId,
									lastCompletedAt: null,
									lastCompletedByName: null,
									openGapCountForAssignee: 1,
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(
			page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Diese Putzaufgabe existiert nicht mehr und wurde aus dem Plan entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('chore_not_found')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }),
		).toBeHidden({ timeout: 5000 });
	});

	test('explains chores that were already completed elsewhere', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();
		let completedAt: string | null = null;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (
				request.method() === 'POST' &&
				request.url().endsWith('/chore-already-completed/complete')
			) {
				completedAt = new Date().toISOString();
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'chore_already_completed' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-already-completed',
							title: 'Flur saugen',
							intervalDays: 7,
							nextDueAt: completedAt
								? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
								: dueDate,
							assignedMemberId: memberId,
							lastCompletedAt: completedAt,
							lastCompletedByName: completedAt ? 'Mara' : null,
							openGapCountForAssignee: completedAt ? 0 : 1,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(
			page.getByRole('button', { name: 'Als erledigt markieren: Flur saugen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Als erledigt markieren: Flur saugen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Erledigt bestätigen: Flur saugen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Diese Putzaufgabe wurde bereits erledigt. Der Plan wird aktualisiert.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('chore_already_completed')).toHaveCount(0);
		await expect(page.getByText('Zuletzt gerade eben von Mara')).toBeVisible({ timeout: 5000 });
	});

	test('explains server failures when completing a chore fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (
				request.method() === 'POST' &&
				request.url().endsWith('/chore-complete-server/complete')
			) {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-complete-server',
							title: 'Küche wischen',
							intervalDays: 7,
							nextDueAt: dueDate,
							assignedMemberId: memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 1,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(
			page.getByRole('button', { name: 'Als erledigt markieren: Küche wischen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Als erledigt markieren: Küche wischen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Erledigt bestätigen: Küche wischen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Erledigt-Aktion konnte nicht gespeichert werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Erledigt-Aktion fehlgeschlagen.')).toHaveCount(0);
		await expect(page.getByText('Noch kein Verlauf')).toBeVisible();
	});

	test('explains partial completion-log failures with refresh guidance', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (
				request.method() === 'POST' &&
				request.url().endsWith('/chore-complete-partial/complete')
			) {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'completion_insert_failed' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-complete-partial',
							title: 'Bad putzen',
							intervalDays: 7,
							nextDueAt: dueDate,
							assignedMemberId: memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 1,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(
			page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText(
				'Erledigt-Aktion konnte nicht vollständig gespeichert werden: Lade den Plan neu und prüfe den Verlauf.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('completion_insert_failed')).toHaveCount(0);
		await expect(
			page.getByText('Erledigt-Aktion konnte nicht gespeichert werden: Versuche es gleich erneut.'),
		).toHaveCount(0);
	});

	test('explains network failures when posting a chore swap request fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			if (route.request().method() === 'POST') {
				await route.abort('failed');
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-swap-network',
							title: 'Bad putzen',
							intervalDays: 7,
							nextDueAt: dueDate,
							assignedMemberId: memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 1,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(page.getByRole('button', { name: 'Tausch anfragen: Bad putzen' })).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Tausch anfragen: Bad putzen' }).click({
			timeout: 5000,
		});

		await expect(
			page.getByText(
				'Tauschanfrage konnte nicht gepostet werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Tauschanfrage konnte nicht gepostet werden.')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Tausch anfragen: Bad putzen' })).toBeVisible();
	});

	test('explains server failures when posting a chore swap request fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error' }),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-swap-server',
							title: 'Bad putzen',
							intervalDays: 7,
							nextDueAt: dueDate,
							assignedMemberId: memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 1,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(page.getByRole('button', { name: 'Tausch anfragen: Bad putzen' })).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Tausch anfragen: Bad putzen' }).click({
			timeout: 5000,
		});

		await expect(
			page.getByText('Tauschanfrage konnte nicht gepostet werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Tauschanfrage konnte nicht gepostet werden.')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Tausch anfragen: Bad putzen' })).toBeVisible();
	});

	test('updates chore assignee after a successful takeover', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();
		let assignedMemberId: string | null = null;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (request.method() === 'PATCH' && request.url().endsWith('/chore-take')) {
				assignedMemberId = memberId;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ chore: { id: 'chore-take' } }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-take',
							title: 'Bad putzen',
							intervalDays: 7,
							nextDueAt: dueDate,
							assignedMemberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(
			page.locator('#chore-chore-take').getByText('Niemand', { exact: true }),
		).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Aufgabe übernehmen: Bad putzen' }).click({
			timeout: 5000,
		});

		await expect(page.locator('#chore-chore-take').getByText('dsaf')).toBeVisible({
			timeout: 5000,
		});
		await expect(
			page.locator('#chore-chore-take').getByText('Niemand', { exact: true }),
		).toHaveCount(0);
	});

	test('removes stale chores when takeover finds them deleted', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (request.method() === 'PATCH' && request.url().endsWith('/chore-stale-take')) {
				deleted = true;
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'chore_not_found' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: deleted
						? []
						: [
								{
									id: 'chore-stale-take',
									title: 'Fenster putzen',
									intervalDays: 14,
									nextDueAt: dueDate,
									assignedMemberId: null,
									lastCompletedAt: null,
									lastCompletedByName: null,
									openGapCountForAssignee: 0,
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(
			page.getByRole('button', { name: 'Aufgabe übernehmen: Fenster putzen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Aufgabe übernehmen: Fenster putzen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Diese Putzaufgabe existiert nicht mehr und wurde aus dem Plan entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('chore_not_found')).toHaveCount(0);
		await expect(page.locator('#chore-chore-stale-take')).toBeHidden({ timeout: 5000 });
	});

	test('explains network failures when taking over a chore fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (request.method() === 'PATCH' && request.url().endsWith('/chore-network-take')) {
				await route.abort('failed');
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-network-take',
							title: 'Fenster putzen',
							intervalDays: 14,
							nextDueAt: dueDate,
							assignedMemberId: null,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(
			page.getByRole('button', { name: 'Aufgabe übernehmen: Fenster putzen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Aufgabe übernehmen: Fenster putzen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText(
				'Aufgabe konnte nicht übernommen werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Aufgabe konnte nicht übernommen werden.')).toHaveCount(0);
		await expect(page.locator('#chore-chore-network-take')).toBeVisible();
	});

	test('explains server failures when taking over a chore fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (request.method() === 'PATCH' && request.url().endsWith('/chore-server-take')) {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-server-take',
							title: 'Fenster putzen',
							intervalDays: 14,
							nextDueAt: dueDate,
							assignedMemberId: null,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(
			page.getByRole('button', { name: 'Aufgabe übernehmen: Fenster putzen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Aufgabe übernehmen: Fenster putzen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Aufgabe konnte nicht übernommen werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Aufgabe konnte nicht übernommen werden.')).toHaveCount(0);
		await expect(page.locator('#chore-chore-server-take')).toBeVisible();
	});

	test('removes stale chores when deleting finds them already gone', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/chore-stale-delete')) {
				deleted = true;
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'chore_not_found' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: deleted
						? []
						: [
								{
									id: 'chore-stale-delete',
									title: 'Keller fegen',
									intervalDays: 30,
									nextDueAt: dueDate,
									assignedMemberId: memberId,
									lastCompletedAt: null,
									lastCompletedByName: null,
									openGapCountForAssignee: 0,
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(page.getByRole('button', { name: 'Aufgabe entfernen: Keller fegen' })).toBeVisible(
			{ timeout: 30_000 },
		);

		await page
			.getByRole('button', { name: 'Aufgabe entfernen: Keller fegen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Aufgabe entfernen bestätigen: Keller fegen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Diese Putzaufgabe existiert nicht mehr und wurde aus dem Plan entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('chore_not_found')).toHaveCount(0);
		await expect(page.locator('#chore-chore-stale-delete')).toBeHidden({ timeout: 5000 });
	});

	test('explains network failures when removing a chore fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const dueDate = new Date().toISOString();

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores**', async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/chore-network-delete')) {
				await route.abort('failed');
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: [
						{
							id: 'chore-network-delete',
							title: 'Keller fegen',
							intervalDays: 30,
							nextDueAt: dueDate,
							assignedMemberId: memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(page.getByRole('button', { name: 'Aufgabe entfernen: Keller fegen' })).toBeVisible(
			{ timeout: 30_000 },
		);

		await page
			.getByRole('button', { name: 'Aufgabe entfernen: Keller fegen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Aufgabe entfernen bestätigen: Keller fegen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Entfernen fehlgeschlagen: Prüfe deine Verbindung und versuche es erneut.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Entfernen fehlgeschlagen.')).toHaveCount(0);
		await expect(page.locator('#chore-chore-network-delete')).toBeVisible();
	});

	test('prefills the chore form from empty-plan templates', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await expect(page.getByText('Starte mit einer typischen WG-Aufgabe:')).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Müll rausbringen' }).click();

		await expect(page.locator('#chore-title')).toHaveValue('Müll rausbringen');
		await expect(page.locator('#chore-title')).toBeFocused();
		await expect(page.getByRole('button', { name: 'alle 3 T.' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});

	test('does not create duplicate chores from rapid submit taps', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let chorePosts = 0;
		let releaseChorePost: (() => void) | null = null;
		const chorePostCanFinish = new Promise<void>((resolve) => {
			releaseChorePost = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			if (route.request().method() === 'POST') {
				chorePosts += 1;
				await chorePostCanFinish;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ chores: [] }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await page.getByRole('button', { name: 'Putzaufgabe erfassen' }).click();
		await page.getByRole('textbox', { name: 'Aufgabe' }).fill('Bad putzen');

		await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).evaluate((button) => {
			button.click();
			button.click();
		});

		await expect.poll(() => chorePosts).toBe(1);
		await expect(page.getByRole('textbox', { name: 'Aufgabe' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'wöchentlich' })).toBeDisabled();
		await expect(page.getByLabel('Zuständig')).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Aufgabe hinzufügen' })).toBeDisabled();
		releaseChorePost?.();
		await expect(page.getByRole('button', { name: 'Putzaufgabe erfassen' })).toBeVisible();
	});

	test('explains when a chore assignee is no longer in the WG', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const staleMemberId = '11111111-1111-4111-8111-111111111111';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
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
				body: JSON.stringify({ chores: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await page.getByRole('button', { name: 'Putzaufgabe erfassen' }).click();
		await page.getByRole('textbox', { name: 'Aufgabe' }).fill('Bad putzen');
		await page.locator('#chore-assigned').evaluate((select, staleMemberId) => {
			const option = document.createElement('option');
			option.value = staleMemberId;
			option.textContent = 'Ex-Mitglied';
			select.append(option);
			(select as HTMLSelectElement).value = staleMemberId;
			select.dispatchEvent(new Event('change', { bubbles: true }));
		}, staleMemberId);

		await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

		await expect(
			page.getByText(
				'Putzaufgabe konnte nicht gespeichert werden: Dieses Mitglied ist nicht mehr in dieser WG.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('member_not_in_wg')).toHaveCount(0);
		await expect(page.getByText('Hinzufügen fehlgeschlagen.')).toBeHidden();
	});

	test('explains stale membership when creating a chore is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
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
				body: JSON.stringify({ chores: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await page.getByRole('button', { name: 'Putzaufgabe erfassen' }).click();
		await page.getByRole('textbox', { name: 'Aufgabe' }).fill('Bad putzen');
		await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

		await expect(
			page.getByText('Putzaufgabe konnte nicht gespeichert werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Hinzufügen fehlgeschlagen.')).toHaveCount(0);
	});

	test('explains server failures when creating a chore fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
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
				body: JSON.stringify({ chores: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await page.getByRole('button', { name: 'Putzaufgabe erfassen' }).click();
		await page.getByRole('textbox', { name: 'Aufgabe' }).fill('Bad putzen');
		await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

		await expect(
			page.getByText('Putzaufgabe konnte nicht gespeichert werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Hinzufügen fehlgeschlagen.')).toHaveCount(0);
		await expect(page.getByRole('textbox', { name: 'Aufgabe' })).toHaveValue('Bad putzen');
	});

	test('explains invalid chore create requests without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'invalid_json' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await page.getByRole('button', { name: 'Putzaufgabe erfassen' }).click();
		await page.getByRole('textbox', { name: 'Aufgabe' }).fill('Bad putzen');
		await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();

		await expect(
			page.getByText('Putzaufgabe konnte nicht gespeichert werden: Die Anfrage war ungültig.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Hinzufügen fehlgeschlagen.')).toHaveCount(0);
		await expect(page.getByText('invalid_json')).toBeHidden();
		await expect(page.getByRole('textbox', { name: 'Aufgabe' })).toHaveValue('Bad putzen');
	});

	test('does not create duplicate absences from rapid save taps', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let absencePosts = 0;
		let releaseAbsencePost: (() => void) | null = null;
		const absencePostCanFinish = new Promise<void>((resolve) => {
			releaseAbsencePost = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			if (route.request().method() === 'POST') {
				absencePosts += 1;
				await absencePostCanFinish;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ absence: null }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await page.getByLabel('Abwesenheit von').fill('2026-05-20');
		await page.getByLabel('Abwesenheit bis').fill('2026-05-21');
		await page.getByPlaceholder('Grund optional').fill('Urlaub');

		await page.getByRole('button', { name: 'Abwesenheit speichern' }).evaluate((button) => {
			button.click();
			button.click();
		});

		await expect.poll(() => absencePosts).toBe(1);
		await expect(page.getByLabel('Abwesendes Mitglied')).toBeDisabled();
		await expect(page.getByLabel('Abwesenheit von')).toBeDisabled();
		await expect(page.getByLabel('Abwesenheit bis')).toBeDisabled();
		await expect(page.getByPlaceholder('Grund optional')).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Abwesenheit speichern' })).toBeDisabled();
		releaseAbsencePost?.();
		await expect(page.getByRole('button', { name: 'Abwesenheit speichern' })).toBeVisible();
	});

	test('explains invalid absence date ranges from the server', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'date_range_invalid' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await page.getByLabel('Abwesenheit von').fill('2026-05-22');
		await page.getByLabel('Abwesenheit bis').fill('2026-05-21');
		await page.getByRole('button', { name: 'Abwesenheit speichern' }).click();

		await expect(
			page.getByText(
				'Abwesenheit konnte nicht gespeichert werden: Das Enddatum liegt vor dem Startdatum.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Abwesenheit konnte nicht gespeichert werden.')).toBeHidden();
	});

	test('explains server failures when saving an absence fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
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
				body: JSON.stringify({ absences: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await page.getByLabel('Abwesenheit von').fill('2026-05-22');
		await page.getByLabel('Abwesenheit bis').fill('2026-05-23');
		await page.getByPlaceholder('Grund optional').fill('Urlaub');
		await page.getByRole('button', { name: 'Abwesenheit speichern' }).click();

		await expect(
			page.getByText('Abwesenheit konnte nicht gespeichert werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Abwesenheit konnte nicht gespeichert werden.')).toHaveCount(0);
		await expect(page.getByLabel('Abwesenheit von')).toHaveValue('2026-05-22');
	});

	test('explains invalid requests when saving an absence fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'invalid_json' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');
		await page.getByLabel('Abwesenheit von').fill('2026-05-22');
		await page.getByLabel('Abwesenheit bis').fill('2026-05-23');
		await page.getByPlaceholder('Grund optional').fill('Urlaub');
		await page.getByRole('button', { name: 'Abwesenheit speichern' }).click();

		await expect(
			page.getByText('Abwesenheit konnte nicht gespeichert werden: Die Anfrage war ungültig.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Abwesenheit konnte nicht gespeichert werden.')).toHaveCount(0);
		await expect(page.getByLabel('Abwesenheit von')).toHaveValue('2026-05-22');
	});

	test('removes stale absences when deleting finds them already gone', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/absences**', async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/absence-stale-delete')) {
				deleted = true;
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'absence_not_found' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					absences: deleted
						? []
						: [
								{
									id: 'absence-stale-delete',
									memberId,
									memberName: 'dsaf',
									startDate: '2026-05-20T00:00:00.000Z',
									endDate: '2026-05-21T23:59:59.000Z',
									reason: 'Urlaub',
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen?panel=absences');
		await expect(page.locator('#absence-absence-stale-delete').getByText('dsaf')).toBeVisible({
			timeout: 30_000,
		});

		await page
			.locator('#absence-absence-stale-delete')
			.getByRole('button', { name: 'Entfernen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Diese Abwesenheit existiert nicht mehr und wurde aus dem Plan entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('absence_not_found')).toHaveCount(0);
		await expect(page.locator('#absence-absence-stale-delete')).toBeHidden({ timeout: 5000 });
	});

	test('explains network failures when removing an absence fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/absences**', async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/absence-network-delete')) {
				await route.abort('failed');
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					absences: [
						{
							id: 'absence-network-delete',
							memberId,
							memberName: 'dsaf',
							startDate: '2026-05-20T00:00:00.000Z',
							endDate: '2026-05-21T23:59:59.000Z',
							reason: 'Urlaub',
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen?panel=absences');
		await expect(page.locator('#absence-absence-network-delete').getByText('dsaf')).toBeVisible({
			timeout: 30_000,
		});

		await page
			.locator('#absence-absence-network-delete')
			.getByRole('button', { name: 'Entfernen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText(
				'Abwesenheit konnte nicht entfernt werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Abwesenheit konnte nicht entfernt werden.')).toHaveCount(0);
		await expect(page.locator('#absence-absence-network-delete')).toBeVisible();
	});

	test('shows every absence in absence focus mode', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const absences = ['Ava', 'Ben', 'Cem', 'Dana', 'Emil'].map((memberName, index) => ({
			id: `absence-e2e-focus-${index}`,
			memberId: `member-e2e-focus-${index}`,
			memberName,
			startDate: '2026-05-20T00:00:00.000Z',
			endDate: '2026-05-21T23:59:59.000Z',
			reason: index === 4 ? 'Fortbildung' : null,
		}));

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');

		await expect(page.getByRole('link', { name: 'Alle 5 Abwesenheiten anzeigen' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText('Emil')).toBeHidden();

		await page.getByRole('link', { name: 'Alle 5 Abwesenheiten anzeigen' }).click();

		await expect(page.getByText('Abwesenheits-Fokus')).toBeVisible({ timeout: 30_000 });
		for (const absence of absences) {
			await expect(
				page.locator(`#absence-${absence.id}`).getByText(absence.memberName),
			).toBeVisible();
		}
	});

	test('lists every overdue chore in the plan itself', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const overdueDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
		const titles = ['Bad putzen', 'Küche wischen', 'Müll rausbringen', 'Flur saugen', 'Fenster'];

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					chores: titles.map((title, index) => ({
						id: `chore-e2e-overdue-${index}`,
						title,
						intervalDays: 7,
						nextDueAt: overdueDate,
						assignedMemberId: memberId,
						lastCompletedAt: null,
						lastCompletedByName: null,
						openGapCountForAssignee: index,
					})),
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');

		// Es gibt keinen Reparaturblock mehr, der die Aufgaben ein zweites Mal
		// auflistet und dabei auf vier deckelt: alle überfälligen stehen direkt
		// in der Liste, nach oben sortiert.
		await expect(page.getByText('Putzlücken-Fokus')).toHaveCount(0);
		for (const title of titles) {
			await expect(page.getByRole('button', { name: `Aufgabe übernehmen: ${title}` })).toBeVisible({
				timeout: 30_000,
			});
		}

		// Der Deep-Link vom Dashboard führt weiterhin auf dieselbe Liste.
		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen?filter=overdue');
		for (const title of titles) {
			await expect(page.getByRole('button', { name: `Aufgabe übernehmen: ${title}` })).toBeVisible({
				timeout: 30_000,
			});
		}
	});

	test('announces queued offline chore actions as status', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'chore-create:MTE8PZAT:e2e-status',
							type: 'chore.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							payload: {
								title: 'Bad putzen',
								intervalDays: 7,
								assignedMemberId: memberId,
							},
						},
					]),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ absences: [] }),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			if (route.request().method() === 'POST') {
				await route.abort('internetdisconnected');
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/putzen');

		await expect(
			page.getByRole('status').filter({
				hasText: /^1 Offline-Aktion wartet auf Synchronisierung\.$/,
			}),
		).toBeVisible({ timeout: 30_000 });
	});
});
