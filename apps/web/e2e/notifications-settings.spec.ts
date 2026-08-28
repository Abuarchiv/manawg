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

test.describe('Notification settings', () => {
	test.setTimeout(300_000);

	test('shows a retryable error when notification status cannot be loaded', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let getRequests = 0;
		let failStatus = true;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				getRequests += 1;
				if (failStatus) {
					await route.fulfill({
						status: 500,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'server_error' }),
					});
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 1000));
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');

		await expect(
			page.getByText('Benachrichtigungen konnten nicht geladen werden: Versuche es gleich erneut.'),
		).toBeVisible();
		await expect(page.getByRole('button', { name: /Web Push/ })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Testbenachrichtigung senden' })).toBeDisabled();
		await expect(page.getByRole('checkbox', { name: /Pinnwand/ })).toBeDisabled();
		await expect(page.getByLabel('Von')).toBeDisabled();

		failStatus = false;
		const beforeRetryRequests = getRequests;
		const retryButton = page.getByRole('button', { name: 'Erneut laden' });
		await retryButton.click();

		await expect(page.getByRole('button', { name: 'Lädt...' })).toBeDisabled();
		await expect.poll(() => getRequests).toBe(beforeRetryRequests + 1);
		await expect(page.getByRole('checkbox', { name: /Pinnwand/ })).toBeEnabled({
			timeout: 30_000,
		});
		expect(getRequests).toBe(beforeRetryRequests + 1);
	});

	test('explains network failures while loading notification settings', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.abort('failed');
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');

		await expect(
			page.getByText(
				'Benachrichtigungen konnten nicht geladen werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Benachrichtigungen konnten nicht geladen werden.')).toHaveCount(0);
	});

	test('explains stale membership when notification status cannot be loaded', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');

		await expect(
			page.getByText('Benachrichtigungen konnten nicht geladen werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Benachrichtigungen konnten nicht geladen werden.')).toHaveCount(0);
	});

	test('does not send duplicate preference saves from rapid clicks', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let patchRequests = 0;
		let releasePatch: () => void = () => undefined;
		const patchCanFinish = new Promise<void>((resolve) => {
			releasePatch = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: false,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
			if (route.request().method() === 'PATCH') {
				patchRequests += 1;
				await patchCanFinish;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');

		const pinnwandToggle = page.getByRole('checkbox', { name: /Pinnwand/ });
		await expect(pinnwandToggle).toBeVisible();
		await pinnwandToggle.evaluate((element: HTMLInputElement) => {
			element.click();
			element.click();
		});

		await expect(page.getByRole('button', { name: /Web Push/ })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Testbenachrichtigung senden' })).toBeDisabled();
		await expect(page.getByLabel('Von')).toBeDisabled();
		await expect.poll(() => patchRequests).toBe(1);
		releasePatch();
	});

	test('explains stale membership when saving notification settings fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: false,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');
		await page.getByRole('checkbox', { name: /Pinnwand/ }).click();

		await expect(
			page.getByText(
				'Benachrichtigungen konnten nicht gespeichert werden: Tritt der WG erneut bei.',
			),
		).toBeVisible();
		await expect(
			page.getByText(
				'Nummer konnte nicht gespeichert werden. Für den Start bitte eine deutsche Nummer nutzen.',
			),
		).toHaveCount(0);
	});

	test('explains network failures when saving notification settings fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: false,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
			if (route.request().method() === 'PATCH') {
				await route.abort('failed');
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');
		await page.getByRole('checkbox', { name: /Pinnwand/ }).click();

		await expect(
			page.getByText(
				'Benachrichtigungen konnten nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByText('Benachrichtigungseinstellung konnte nicht gespeichert werden.'),
		).toHaveCount(0);
	});

	test('explains server failures when saving notification settings fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: false,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');
		await page.getByRole('checkbox', { name: /Pinnwand/ }).click();

		await expect(
			page.getByText(
				'Benachrichtigungen konnten nicht gespeichert werden: Versuche es gleich erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByText('Benachrichtigungseinstellung konnte nicht gespeichert werden.'),
		).toHaveCount(0);
	});

	test('explains invalid notification setting requests without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: false,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'invalid_json' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');
		await page.getByRole('checkbox', { name: /Pinnwand/ }).click();

		await expect(
			page.getByText(
				'Benachrichtigungen konnten nicht gespeichert werden: Die Anfrage war ungültig.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByText('Benachrichtigungseinstellung konnte nicht gespeichert werden.'),
		).toHaveCount(0);
		await expect(page.getByText('invalid_json')).toBeHidden();
	});

	test('turns quiet hours fully off when either time field is set to off', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const patchBodies: unknown[] = [];

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: 22,
						quietEndHour: 7,
						pushConfigured: true,
					}),
				});
				return;
			}
			if (route.request().method() === 'PATCH') {
				patchBodies.push(route.request().postDataJSON());
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');
		await expect(page.getByLabel('Von')).toHaveValue('22');
		await expect(page.getByLabel('Bis')).toHaveValue('7');

		await page.getByLabel('Von').selectOption('');

		await expect(page.getByLabel('Von')).toHaveValue('');
		await expect(page.getByLabel('Bis')).toHaveValue('');
		await expect.poll(() => patchBodies).toEqual([{ quietStartHour: null, quietEndHour: null }]);
	});

	test('announces successful test notification feedback as status', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let resyncRequests = 0;
		let testRequests = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				Object.defineProperty(window, 'PushManager', {
					configurable: true,
					value: class PushManager {},
				});
				Object.defineProperty(navigator, 'serviceWorker', {
					configurable: true,
					value: {
						getRegistration: async () => ({
							pushManager: {
								getSubscription: async () => ({
									toJSON: () => ({
										endpoint: 'https://push.example.test/subscription-1',
										keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
									}),
								}),
							},
						}),
					},
				});
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: false,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
			if (route.request().method() === 'POST') {
				const body = route.request().postDataJSON() as { action?: string };
				if (body.action === 'push_subscribe') {
					resyncRequests += 1;
				}
				if (body.action === 'test_notification') {
					testRequests += 1;
				}
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');
		await expect.poll(() => resyncRequests).toBe(1);
		await page.getByRole('button', { name: 'Testbenachrichtigung senden' }).click();

		await expect(page.getByRole('status')).toContainText(
			'Test wurde ausgelöst. Prüfe Push und WG-Chat.',
		);
		expect(testRequests).toBe(1);
	});

	test('explains stale membership when sending a test notification fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');
		await page.getByRole('button', { name: 'Testbenachrichtigung senden' }).click();

		await expect(
			page.getByText('Testbenachrichtigung konnte nicht gesendet werden: Tritt der WG erneut bei.'),
		).toBeVisible();
		await expect(page.getByText('Test konnte nicht gesendet werden.')).toHaveCount(0);
	});

	test('explains network failures when sending a test notification fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
			if (route.request().method() === 'POST') {
				await route.abort('failed');
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');
		await page.getByRole('button', { name: 'Testbenachrichtigung senden' }).click();

		await expect(
			page.getByText(
				'Testbenachrichtigung konnte nicht gesendet werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Test konnte nicht gesendet werden.')).toHaveCount(0);
	});

	test('explains server failures when sending a test notification fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/notifications', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					}),
				});
				return;
			}
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#benachrichtigungen');
		await page.getByRole('button', { name: 'Testbenachrichtigung senden' }).click();

		await expect(
			page.getByText(
				'Testbenachrichtigung konnte nicht gesendet werden: Versuche es gleich erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Test konnte nicht gesendet werden.')).toHaveCount(0);
	});
});
