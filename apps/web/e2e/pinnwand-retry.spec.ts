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
			await page.waitForTimeout(1000);
		}
	}
	throw lastError;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function announcementBody(memberId: string, id: string, content: string) {
	return {
		announcements: [
			{
				id,
				authorMemberId: memberId,
				content,
				imageUrl: null,
				kind: 'info',
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
	};
}

test.describe('Pinnwand recovery', () => {
	test.setTimeout(300_000);

	test('requires a WG member for pinnwand API data', async ({ request }) => {
		const [announcementsResponse, commentsResponse, membersResponse] = await Promise.all([
			request.get('/api/wg/MTE8PZAT/announcements', {
				timeout: 120_000,
			}),
			request.get('/api/wg/MTE8PZAT/announcements/00000000-0000-4000-8000-000000000001/comments', {
				timeout: 120_000,
			}),
			request.get('/api/wg/MTE8PZAT/members', {
				timeout: 120_000,
			}),
		]);

		expect(announcementsResponse.status()).toBe(401);
		expect(commentsResponse.status()).toBe(401);
		expect(membersResponse.status()).toBe(401);
		await expect(announcementsResponse.json()).resolves.toMatchObject({
			error: 'member_id_required',
		});
		await expect(commentsResponse.json()).resolves.toMatchObject({ error: 'member_id_required' });
		await expect(membersResponse.json()).resolves.toMatchObject({ error: 'member_id_required' });
	});

	test('shows a retryable page load error instead of pretending the board is empty', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let failAnnouncements = true;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			if (failAnnouncements) {
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
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');

		await expect(
			page.getByText('Pinnwand konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText('Noch keine Beiträge geladen.')).toBeVisible();

		failAnnouncements = false;
		await page.getByRole('button', { name: 'Pinnwand erneut laden' }).click();

		await expect(page.getByText('Bitte Küche wischen')).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByText('Pinnwand konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeHidden();
	});

	test('explains network failures while loading the board', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.abort('failed');
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');

		await expect(
			page.getByText(
				'Pinnwand konnte nicht geladen werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Pinnwand konnte nicht geladen werden.')).toHaveCount(0);
	});

	test('explains stale membership when pinnwand load is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');

		await expect(
			page.getByText('Pinnwand konnte nicht geladen werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Pinnwand konnte nicht geladen werden.')).toHaveCount(0);
	});

	test('restores non-text announcement drafts by opening the composer', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					`manawg:draft:MTE8PZAT:${memberId}:announcement`,
					JSON.stringify({
						content: '',
						kind: 'question',
						imageUrl: 'https://cdn.example.test/draft.png',
					}),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ announcements: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');

		await expect(page.locator('#announcement-content')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'Frage' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.getByRole('img', { name: 'Beitragsbild hochgeladen' })).toBeVisible();
	});

	test('prefills the composer from empty-board templates', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ announcements: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');

		await expect(page.getByText('Starte mit einem typischen WG-Beitrag.')).toBeVisible({
			timeout: 30_000,
		});
		await page.getByRole('button', { name: 'Wer kann helfen?' }).click();

		await expect(page.locator('#announcement-content')).toHaveValue('Wer kann kurz helfen?');
		await expect(page.locator('#announcement-content')).toBeFocused();
		await expect(page.getByRole('button', { name: 'Frage' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});
	test('does not create duplicate posts from rapid submit taps', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let posts = 0;
		let releasePost: (() => void) | null = null;
		const postCanFinish = new Promise<void>((resolve) => {
			releasePost = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			if (route.request().method() === 'POST') {
				posts += 1;
				await postCanFinish;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						announcement: {
							id: 'announcement-created',
							authorMemberId: memberId,
							content: 'Paket liegt im Flur',
							imageUrl: null,
							kind: 'info',
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
					}),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ announcements: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Beitrag erstellen' }).click();
		await page.getByPlaceholder(/Was gibt es Neues/).fill('Paket liegt im Flur');

		await page.getByRole('button', { name: 'Posten' }).evaluate((button) => {
			button.click();
			button.click();
		});

		await expect.poll(() => posts).toBe(1);
		await expect(page.getByRole('button', { name: 'Wird gepostet…' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Beitrag abbrechen' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Frage' })).toBeDisabled();
		await expect(page.getByPlaceholder(/Was gibt es Neues/)).toBeDisabled();
		await expect(page.getByLabel('Bild auswählen')).toBeDisabled();
		releasePost?.();
		await expect(page.getByRole('button', { name: 'Beitrag erstellen' })).toBeVisible();
	});

	test('explains invalid post content without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'content_invalid' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ announcements: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Beitrag erstellen' }).click();
		await page.getByPlaceholder(/Was gibt es Neues/).fill('Paket liegt im Flur');
		await page.getByRole('button', { name: 'Posten' }).click();

		await expect(
			page.getByText(
				'Beitrag konnte nicht gespeichert werden: Der Text muss 1 bis 2000 Zeichen haben.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('content_invalid')).toHaveCount(0);
	});

	test('explains stale membership when creating a post is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
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
				body: JSON.stringify({ announcements: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Beitrag erstellen' }).click();
		await page.getByPlaceholder(/Was gibt es Neues/).fill('Paket liegt im Flur');
		await page.getByRole('button', { name: 'Posten' }).click();

		await expect(
			page.getByText('Beitrag konnte nicht gespeichert werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Beitrag konnte nicht gespeichert werden.')).toHaveCount(0);
	});

	test('announces an offline-created post as status instead of an error', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.removeItem('manawg:offline-actions');
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			if (route.request().method() === 'POST') {
				await route.abort('internetdisconnected');
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ announcements: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Beitrag erstellen' }).click();
		await page.getByPlaceholder(/Was gibt es Neues/).fill('Offline Notiz');
		await page.getByRole('button', { name: 'Posten' }).click();

		await expect(
			page.getByRole('alert').filter({ hasText: 'Offline gespeichert. Wird synchronisiert' }),
		).toBeVisible();
		await expect(
			page.getByRole('alert').filter({
				hasText: /^1 Offline-Aktion wartet auf Synchronisierung\.$/,
			}),
		).toBeVisible();
		await expect(
			page.getByRole('alert').filter({ hasText: 'Beitrag konnte nicht gespeichert werden' }),
		).toHaveCount(0);
	});

	test('does not create duplicate comments from rapid send taps', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let comments = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-1/comments', async (route) => {
			if (route.request().method() === 'POST') {
				comments += 1;
				await delay(250);
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						comment: {
							id: 'comment-created',
							announcementId: 'announcement-1',
							memberId,
							content: 'Übernehme ich',
							createdAt: new Date().toISOString(),
							authorName: 'dsaf',
							authorColor: null,
						},
					}),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Beitragsaktionen: Bitte Küche wischen' }).click();
		await expect(
			page.getByRole('menuitem', { name: 'Als Einkauf übernehmen: Bitte Küche wischen' }),
		).toHaveAttribute('href', /\/wg\/MTE8PZAT\/einkauf/);
		await expect(
			page.getByRole('menuitem', { name: 'Als Aufgabe übernehmen: Bitte Küche wischen' }),
		).toHaveAttribute('href', /\/wg\/MTE8PZAT\/putzen/);
		await expect(
			page.getByRole('menuitem', { name: 'Als Ausgabe übernehmen: Bitte Küche wischen' }),
		).toHaveAttribute('href', /\/wg\/MTE8PZAT\/ausgaben/);
		await expect(
			page.getByRole('menuitem', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Übernehme ich-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(
			page.getByRole('menuitem', { name: 'Als Einkauf übernehmen: Bitte Küche wischen' }),
		).toBeHidden();
		await page.getByRole('button', { name: 'Antworten anzeigen: Bitte Küche wischen' }).click();
		await page.getByPlaceholder('Antwort schreiben').fill('Übernehme ich');

		await page
			.getByRole('button', { name: 'Antwort senden: Bitte Küche wischen' })
			.evaluate((button) => {
				button.click();
				button.click();
			});

		await expect.poll(() => comments).toBe(1);
	});

	test('keeps newly created comments when the next refresh is stale', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let announcementGets = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-1/comments', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						comment: {
							id: 'comment-created',
							announcementId: 'announcement-1',
							memberId,
							content: 'Übernehme ich',
							createdAt: new Date().toISOString(),
							authorName: 'dsaf',
							authorColor: null,
						},
					}),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			announcementGets += 1;
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Antworten anzeigen: Bitte Küche wischen' }).click();
		await page.getByPlaceholder('Antwort schreiben').fill('Übernehme ich');
		await page.getByRole('button', { name: 'Antwort senden: Bitte Küche wischen' }).click();

		const createdComment = page.locator('p').filter({ hasText: /^Übernehme ich$/ });
		await expect(createdComment).toBeVisible({ timeout: 30_000 });
		await expect.poll(() => announcementGets).toBeGreaterThan(1);
		await expect(createdComment).toBeVisible();
	});

	test('explains network failures when creating a comment fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-1/comments', async (route) => {
			if (route.request().method() === 'POST') {
				await route.abort('failed');
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Antworten anzeigen: Bitte Küche wischen' }).click();
		await page.getByPlaceholder('Antwort schreiben').fill('Übernehme ich');
		await page.getByRole('button', { name: 'Antwort senden: Bitte Küche wischen' }).click();

		await expect(
			page.getByText(
				'Kommentar konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Kommentar-Aktion fehlgeschlagen.')).toHaveCount(0);
		await expect(page.locator('p').filter({ hasText: /^Übernehme ich$/ })).toHaveCount(0);
	});

	test('explains server failures when creating a comment fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-1/comments', async (route) => {
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
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Antworten anzeigen: Bitte Küche wischen' }).click();
		await page.getByPlaceholder('Antwort schreiben').fill('Übernehme ich');
		await page.getByRole('button', { name: 'Antwort senden: Bitte Küche wischen' }).click();

		await expect(
			page.getByText('Kommentar-Aktion fehlgeschlagen: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Kommentar-Aktion fehlgeschlagen.')).toHaveCount(0);
		await expect(page.getByText('unexpected_error')).toHaveCount(0);
		await expect(page.locator('p').filter({ hasText: /^Übernehme ich$/ })).toHaveCount(0);
	});

	test('removes stale posts when commenting finds them deleted', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route(
			'**/api/wg/MTE8PZAT/announcements/announcement-stale/comments',
			async (route) => {
				if (route.request().method() === 'POST') {
					await route.fulfill({
						status: 404,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'announcement_not_found' }),
					});
					return;
				}
				await route.fallback();
			},
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					announcementBody(memberId, 'announcement-stale', 'Bitte Küche wischen'),
				),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Antworten anzeigen: Bitte Küche wischen' }).click();
		await page.getByPlaceholder('Antwort schreiben').fill('Übernehme ich');
		await page
			.getByRole('button', { name: 'Antwort senden: Bitte Küche wischen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Dieser Pinnwand-Beitrag existiert nicht mehr und wurde entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.locator('#announcement-announcement-stale')).toBeHidden({ timeout: 5000 });
		await expect(page.getByText('announcement_not_found')).toBeHidden();
	});

	test('keeps comment editing controls disabled while saving an edit', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let releasePatch: (() => void) | null = null;
		const patchCanFinish = new Promise<void>((resolve) => {
			releasePatch = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route(
			'**/api/wg/MTE8PZAT/announcements/announcement-1/comments/comment-1',
			async (route) => {
				if (route.request().method() === 'PATCH') {
					await patchCanFinish;
					await route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({
							comment: {
								id: 'comment-1',
								announcementId: 'announcement-1',
								memberId,
								content: 'Ich mache das heute',
								createdAt: new Date().toISOString(),
								authorName: 'dsaf',
								authorColor: null,
							},
						}),
					});
					return;
				}
				await route.fallback();
			},
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
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
							comments: [
								{
									id: 'comment-1',
									announcementId: 'announcement-1',
									memberId,
									content: 'Ich mache das',
									createdAt: new Date().toISOString(),
									authorName: 'dsaf',
									authorColor: null,
								},
							],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Antworten anzeigen: Bitte Küche wischen' }).click();
		await expect(page.getByText('Ich mache das')).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: 'Kommentar bearbeiten: Ich mache das' }).click();
		const editor = page.locator('textarea').filter({ hasText: 'Ich mache das' });
		await expect(editor).toHaveValue('Ich mache das');
		await editor.fill('Ich mache das heute');
		await page.getByRole('button', { name: 'Kommentar speichern: Ich mache das' }).click();

		await expect(editor).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Später' })).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'Kommentar speichern: Ich mache das' }),
		).toBeDisabled();
		releasePatch?.();
		await expect(page.getByText('Ich mache das heute')).toBeVisible({ timeout: 30_000 });
	});

	test('removes stale comments when editing finds them deleted', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route(
			'**/api/wg/MTE8PZAT/announcements/announcement-1/comments/comment-stale',
			async (route) => {
				if (route.request().method() === 'PATCH') {
					await route.fulfill({
						status: 404,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'comment_not_found' }),
					});
					return;
				}
				await route.fallback();
			},
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
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
							comments: [
								{
									id: 'comment-stale',
									announcementId: 'announcement-1',
									memberId,
									content: 'Ich mache das',
									createdAt: new Date().toISOString(),
									authorName: 'dsaf',
									authorColor: null,
								},
							],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Antworten anzeigen: Bitte Küche wischen' }).click();
		await expect(page.getByText('Ich mache das')).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: 'Kommentar bearbeiten: Ich mache das' }).click();
		const editor = page.locator('textarea').filter({ hasText: 'Ich mache das' });
		await expect(editor).toHaveValue('Ich mache das');
		await editor.fill('Ich mache das heute');
		await page.getByRole('button', { name: 'Kommentar speichern: Ich mache das' }).click();

		await expect(
			page.getByText('Dieser Kommentar existiert nicht mehr und wurde entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Ich mache das')).toBeHidden({ timeout: 5000 });
		await expect(page.getByText('comment_not_found')).toBeHidden();
	});

	test('explains invalid comment edits without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route(
			'**/api/wg/MTE8PZAT/announcements/announcement-1/comments/comment-1',
			async (route) => {
				if (route.request().method() === 'PATCH') {
					await route.fulfill({
						status: 400,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'comment_invalid' }),
					});
					return;
				}
				await route.fallback();
			},
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
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
							comments: [
								{
									id: 'comment-1',
									announcementId: 'announcement-1',
									memberId,
									content: 'Ich mache das',
									createdAt: new Date().toISOString(),
									authorName: 'dsaf',
									authorColor: null,
								},
							],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Antworten anzeigen: Bitte Küche wischen' }).click();
		await expect(page.getByText('Ich mache das')).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: 'Kommentar bearbeiten: Ich mache das' }).click();
		const editor = page.locator('textarea').filter({ hasText: 'Ich mache das' });
		await editor.fill('Ich mache das heute');
		await page.getByRole('button', { name: 'Kommentar speichern: Ich mache das' }).click();

		await expect(
			page.getByText(
				'Kommentar konnte nicht gespeichert werden: Der Text muss 1 bis 600 Zeichen haben.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('comment_invalid')).toBeHidden();
		await expect(page.getByText('Ich mache das')).toBeVisible();
	});

	test('explains network failures when saving a comment edit fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route(
			'**/api/wg/MTE8PZAT/announcements/announcement-1/comments/comment-1',
			async (route) => {
				if (route.request().method() === 'PATCH') {
					await route.abort('failed');
					return;
				}
				await route.fallback();
			},
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
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
							comments: [
								{
									id: 'comment-1',
									announcementId: 'announcement-1',
									memberId,
									content: 'Ich mache das',
									createdAt: new Date().toISOString(),
									authorName: 'dsaf',
									authorColor: null,
								},
							],
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Antworten anzeigen: Bitte Küche wischen' }).click();
		await expect(page.getByText('Ich mache das')).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: 'Kommentar bearbeiten: Ich mache das' }).click();
		const editor = page.locator('textarea').filter({ hasText: 'Ich mache das' });
		await editor.fill('Ich mache das heute');
		await page.getByRole('button', { name: 'Kommentar speichern: Ich mache das' }).click();

		await expect(
			page.getByText(
				'Kommentar konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Kommentar-Aktion fehlgeschlagen.')).toHaveCount(0);
		await expect(page.getByText('Ich mache das')).toBeVisible();
	});

	test('keeps optimistic pin state stable during rapid pin taps', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let patches = 0;
		let pinnedAt: string | null = null;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-1', async (route) => {
			if (route.request().method() === 'PATCH') {
				patches += 1;
				pinnedAt = new Date().toISOString();
				await delay(250);
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ announcement: { id: 'announcement-1' } }),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: memberId,
							content: 'Bitte Küche wischen',
							imageUrl: null,
							kind: 'request',
							status: 'open',
							source: 'manual',
							sourcePath: null,
							pinnedAt,
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');

		await page.getByRole('button', { name: 'Beitragsaktionen: Bitte Küche wischen' }).click();
		await expect(
			page.getByRole('menuitem', { name: 'Beitrag entfernen: Bitte Küche wischen' }),
		).toBeVisible();

		await page
			.getByRole('menuitem', { name: 'Beitrag fixieren: Bitte Küche wischen' })
			.evaluate((button) => {
				button.click();
				button.click();
			});

		await expect.poll(() => patches).toBe(1);
		await expect(page.locator('#announcement-announcement-1').getByText('Fixiert')).toBeVisible();
	});

	test('removes stale posts when pinning finds them deleted', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-stale', async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'announcement_not_found' }),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					announcementBody(memberId, 'announcement-stale', 'Bitte Küche wischen'),
				),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Beitragsaktionen: Bitte Küche wischen' }).click();
		await expect(
			page.getByRole('menuitem', { name: 'Beitrag fixieren: Bitte Küche wischen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('menuitem', { name: 'Beitrag fixieren: Bitte Küche wischen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Dieser Pinnwand-Beitrag existiert nicht mehr und wurde entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.locator('#announcement-announcement-stale')).toBeHidden({ timeout: 5000 });
		await expect(page.getByText('announcement_not_found')).toBeHidden();
	});

	test('removes stale posts when reacting finds them deleted', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route(
			'**/api/wg/MTE8PZAT/announcements/announcement-stale/reactions',
			async (route) => {
				if (route.request().method() === 'POST') {
					await route.fulfill({
						status: 404,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'announcement_not_found' }),
					});
					return;
				}
				await route.fallback();
			},
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					announcementBody(memberId, 'announcement-stale', 'Bitte Küche wischen'),
				),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await expect(
			page.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Dieser Pinnwand-Beitrag existiert nicht mehr und wurde entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.locator('#announcement-announcement-stale')).toBeHidden({ timeout: 5000 });
		await expect(page.getByText('announcement_not_found')).toBeHidden();
	});

	test('explains invalid reactions without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-1/reactions', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'reaction_invalid' }),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(announcementBody(memberId, 'announcement-1', 'Bitte Küche wischen')),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await expect(
			page.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Reaktion konnte nicht gespeichert werden: Die Reaktion ist ungültig.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('reaction_invalid')).toBeHidden();
		await expect(
			page.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible();
	});

	test('explains reaction server failures without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-1/reactions', async (route) => {
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
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(announcementBody(memberId, 'announcement-1', 'Bitte Küche wischen')),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await expect(
			page.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Pinnwand-Aktion fehlgeschlagen: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Pinnwand-Aktion fehlgeschlagen.')).toHaveCount(0);
		await expect(page.getByText('unexpected_error')).toBeHidden();
		await expect(
			page.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible();
	});

	test('explains invalid pinnwand action requests without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-1/reactions', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'invalid_body' }),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(announcementBody(memberId, 'announcement-1', 'Bitte Küche wischen')),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await expect(
			page.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Pinnwand-Aktion konnte nicht gespeichert werden: Die Anfrage war ungültig.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Pinnwand-Aktion konnte nicht gespeichert werden.')).toHaveCount(0);
		await expect(page.getByText('invalid_body')).toBeHidden();
		await expect(
			page.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible();
	});

	test('explains network failures when saving a reaction fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements/announcement-1/reactions', async (route) => {
			await route.abort('failed');
		});
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(announcementBody(memberId, 'announcement-1', 'Bitte Küche wischen')),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await expect(
			page.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText(
				'Pinnwand-Aktion fehlgeschlagen: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Pinnwand-Aktion fehlgeschlagen.')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Gesehen-Reaktion setzen: Bitte Küche wischen' }),
		).toBeVisible();
	});

	test('removes deleted posts after a successful delete', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements**', async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/announcement-delete')) {
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
				body: JSON.stringify(
					deleted
						? { announcements: [] }
						: announcementBody(memberId, 'announcement-delete', 'Bitte Müll rausbringen'),
				),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Beitragsaktionen: Bitte Müll rausbringen' }).click();
		await expect(
			page.getByRole('menuitem', { name: 'Beitrag entfernen: Bitte Müll rausbringen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('menuitem', { name: 'Beitrag entfernen: Bitte Müll rausbringen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Beitrag entfernen bestätigen: Bitte Müll rausbringen' })
			.click({ timeout: 5000 });

		await expect(page.locator('#announcement-announcement-delete')).toHaveCount(0, {
			timeout: 5000,
		});
	});

	test('removes stale posts when deleting finds them already gone', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements**', async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/announcement-stale')) {
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'announcement_not_found' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					announcementBody(memberId, 'announcement-stale', 'Bitte Müll rausbringen'),
				),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/pinnwand');
		await page.getByRole('button', { name: 'Beitragsaktionen: Bitte Müll rausbringen' }).click();
		await expect(
			page.getByRole('menuitem', { name: 'Beitrag entfernen: Bitte Müll rausbringen' }),
		).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('menuitem', { name: 'Beitrag entfernen: Bitte Müll rausbringen' })
			.click({ timeout: 5000 });
		await page
			.getByRole('button', { name: 'Beitrag entfernen bestätigen: Bitte Müll rausbringen' })
			.click({ timeout: 5000 });

		await expect(
			page.getByText('Dieser Pinnwand-Beitrag existiert nicht mehr und wurde entfernt.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.locator('#announcement-announcement-stale')).toBeHidden({ timeout: 5000 });
		await expect(page.getByText('announcement_not_found')).toBeHidden();
	});
});
