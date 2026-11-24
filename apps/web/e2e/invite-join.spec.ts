// Invitation flow (fixture lane): a creator gets a personal link, the link opens the join page, joining lands in the WG.
// Why: the share code is only the WG's address; the link is the only way in.

import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_WG, mockNoWgs, setupMember, skipUnlessFixtures } from './support/helpers';
import { setLocale } from './support/i18n';

test.describe('invitation link', () => {
	skipUnlessFixtures();

	test('the created WG offers a personal link; opening it and entering a name joins the WG', async ({
		page,
	}) => {
		await setupMember(page);
		await mockNoWgs(page);

		await page.goto('/login');
		await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
		await page.getByLabel('WG-Name').fill('Fixture WG');
		await page.getByLabel('Dein Anzeigename').fill('Anna');
		await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();

		const linkButton = page.getByRole('button', { name: 'Einladungslink kopieren' });
		await expect(linkButton).toContainText('/invite/', { timeout: 30_000 });
		await expect(page.getByText('Er gilt 14 Tage.')).toBeVisible();
		const link = (await linkButton.textContent())?.trim() ?? '';
		expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{22}$/);

		await page.goto(link);
		await expect(
			page.getByRole('heading', { name: 'Tritt der WG „Kastanienallee 12“ bei' }),
		).toBeVisible();
		await page.getByLabel('Dein Anzeigename').fill('Mira Neu');
		await page.getByRole('button', { name: 'Beitreten', exact: true }).click();

		await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}$`));
	});

	for (const [locale, choose, create] of [
		['de', 'Deine WG', 'Neue WG erstellen'],
		['en', 'Your flat', 'Create a new flat'],
		['es', 'Tu piso', 'Crear un piso nuevo'],
	] as const) {
		test(`announces the start step on the same URL (${locale})`, async ({
			page,
			context,
			baseURL,
		}) => {
			await setLocale(context, baseURL ?? '', locale);
			await setupMember(page);
			await mockNoWgs(page);
			await page.goto('/login');
			await expect(page.getByRole('heading', { name: choose, level: 1 })).toBeVisible();
			await expect(page).toHaveTitle(`${choose} — ManaWG`);
			await page.getByRole('button', { name: create, exact: true }).click();
			await expect(page).toHaveTitle(`${create} — ManaWG`);
			await expect(page.getByRole('status').filter({ hasText: `${create} — ManaWG` })).toHaveCount(
				1,
			);
		});
	}

	test('each start step has its own title and the invite step survives a reload', async ({
		page,
	}) => {
		await setupMember(page);
		await mockNoWgs(page);

		await page.goto('/login');
		await expect(page.getByRole('heading', { name: 'Deine WG', level: 1 })).toBeVisible();
		await expect(page).toHaveTitle('Deine WG — ManaWG');
		await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
		await expect(page).toHaveTitle('Neue WG erstellen — ManaWG');
		// One URL for all steps: the router's announcer stays silent, the page announces the step.
		await expect(
			page.getByRole('status').filter({ hasText: 'Neue WG erstellen — ManaWG' }),
		).toHaveCount(1);
		await page.getByLabel('WG-Name').fill('Fixture WG');
		await page.getByLabel('Dein Anzeigename').fill('Anna');
		const createResponse = page.waitForResponse(
			(response) => response.url().endsWith('/api/wg') && response.request().method() === 'POST',
		);
		await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();
		const created = (await (await createResponse).json()) as {
			wg: { id: string; shareCode: string };
			creator: { id: string };
		};

		await expect(page.getByRole('heading', { name: 'WG erstellt', level: 1 })).toBeVisible();
		await expect(page).toHaveTitle('WG erstellt — ManaWG');
		await expect(page.getByRole('status').filter({ hasText: 'WG erstellt — ManaWG' })).toHaveCount(
			1,
		);
		await expect(page.getByRole('button', { name: 'Einladungslink kopieren' })).toContainText(
			'/invite/',
		);

		// After the reload the account lists the new WG; the invite step must come back.
		await page.route('**/api/wg/mine', (route) =>
			route.fulfill({
				json: {
					wgs: [
						{
							id: created.wg.id,
							code: created.wg.shareCode,
							name: 'Fixture WG',
							memberId: created.creator.id,
						},
					],
				},
			}),
		);
		await page.reload();
		// A cold reload waits for the session check and the account's WG list.
		await expect(page.getByRole('heading', { name: 'WG erstellt', level: 1 })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page).toHaveTitle('WG erstellt — ManaWG');
		await expect(page.getByRole('button', { name: 'Einladungslink kopieren' })).toContainText(
			'/invite/',
			{ timeout: 30_000 },
		);
		await page.getByRole('button', { name: 'Zur WG', exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/wg/${created.wg.shareCode}$`));
	});

	test.describe('name errors on the join page', () => {
		const TOKEN = 'fixture-invite-token01';

		async function openJoinPage(page: Page): Promise<void> {
			await setupMember(page);
			await mockNoWgs(page);
			await page.route(`**/api/wg/invites/${TOKEN}`, (route) =>
				route.fulfill({
					status: 200,
					json: { wg: { name: 'Altbau', shareCode: FIXTURE_WG.shareCode } },
				}),
			);
			await page.goto(`/invite/${TOKEN}`);
			await expect(page.getByLabel('Dein Anzeigename')).toBeVisible({ timeout: 60_000 });
		}

		test('a taken name keeps its error, marks the field and moves focus back to it', async ({
			page,
		}) => {
			await page.route('**/api/wg/*/members', (route) =>
				route.fulfill({ status: 409, json: { error: 'name_taken' } }),
			);
			await openJoinPage(page);
			await page.getByLabel('Dein Anzeigename').fill('Mia');
			await page.getByRole('button', { name: 'Beitreten', exact: true }).click();

			const alert = page.locator('#join-name-error');
			await expect(alert).toContainText('Der Name ist in dieser WG schon vergeben.');
			await page.waitForTimeout(1000);
			await expect(alert).toContainText('Der Name ist in dieser WG schon vergeben.');
			const field = page.locator('#join-name');
			await expect(field).toHaveAttribute('aria-invalid', 'true');
			await expect(field).toHaveAttribute('aria-describedby', 'join-name-error');
			await expect(field).toBeFocused();

			await field.fill('Mia2');
			await expect(alert).toHaveCount(0);
			await expect(field).not.toHaveAttribute('aria-invalid', 'true');
		});

		test('an empty name marks the field, focuses it and clears the error once a name is typed', async ({
			page,
		}) => {
			await openJoinPage(page);
			await page.getByRole('button', { name: 'Beitreten', exact: true }).click();

			const field = page.locator('#join-name');
			await expect(page.locator('#join-name-error')).toBeVisible();
			await expect(field).toHaveAttribute('aria-invalid', 'true');
			await expect(field).toBeFocused();

			await field.fill('Neu');
			await expect(page.locator('#join-name-error')).toHaveCount(0);
		});
	});

	test.describe('one-tap join with a known account name', () => {
		const TOKEN = 'fixture-invite-token01';

		async function openJoinPage(page: Page, name: string | null): Promise<void> {
			await setupMember(page);
			await mockNoWgs(page);
			await page.route('**/api/auth/identities', (route) =>
				route.fulfill({
					json: { email: 'mira@example.test', hasPassword: false, hasGoogle: false, name },
				}),
			);
			await page.route(`**/api/wg/invites/${TOKEN}`, (route) =>
				route.fulfill({
					status: 200,
					json: { wg: { name: 'Altbau', shareCode: FIXTURE_WG.shareCode } },
				}),
			);
			await page.goto(`/invite/${TOKEN}`);
		}

		test('joins with the account name in one tap, without a field or a keyboard', async ({
			page,
		}) => {
			let sentName = '';
			await page.route('**/api/wg/*/members', (route) => {
				if (route.request().method() !== 'POST') return route.fallback();
				sentName = (route.request().postDataJSON() as { name: string }).name;
				return route.fulfill({
					json: { member: { id: 'm1', name: sentName, role: 'member' } },
				});
			});
			await openJoinPage(page, 'Mira');
			const join = page.getByRole('button', { name: 'Beitreten als Mira', exact: true });
			await expect(join).toBeVisible({ timeout: 60_000 });
			await expect(page.getByLabel('Dein Anzeigename')).toHaveCount(0);
			expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
			await join.click();
			await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}$`));
			expect(sentName).toBe('Mira');
		});

		test('"Namen ändern" opens the field, focused, with the name filled in', async ({ page }) => {
			await openJoinPage(page, 'Mira');
			await page
				.getByRole('button', { name: 'Namen ändern', exact: true })
				.click({ timeout: 60_000 });
			const field = page.getByLabel('Dein Anzeigename');
			await expect(field).toHaveValue('Mira');
			await expect(field).toBeFocused();
			await expect(page.getByRole('button', { name: 'Beitreten', exact: true })).toBeVisible();
		});

		test('a taken account name opens the field with the error', async ({ page }) => {
			await page.route('**/api/wg/*/members', (route) =>
				route.fulfill({ status: 409, json: { error: 'name_taken' } }),
			);
			await openJoinPage(page, 'Mira');
			await page
				.getByRole('button', { name: 'Beitreten als Mira', exact: true })
				.click({ timeout: 60_000 });
			await expect(page.locator('#join-name-error')).toContainText(
				'Der Name ist in dieser WG schon vergeben.',
			);
			await expect(page.locator('#join-name')).toBeFocused();
		});

		test('creating a WG asks for the WG name only when the account name is known', async ({
			page,
		}) => {
			await setupMember(page);
			await mockNoWgs(page);
			await page.route('**/api/auth/identities', (route) =>
				route.fulfill({
					json: { email: 'anna@example.test', hasPassword: false, hasGoogle: false, name: 'Anna' },
				}),
			);
			await page.goto('/login');
			await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
			await expect(page.getByLabel('WG-Name')).toBeFocused({ timeout: 60_000 });
			await expect(page.getByLabel('Dein Anzeigename')).toHaveCount(0);
			await page.getByRole('button', { name: 'Du heißt Anna · ändern' }).click();
			const field = page.getByLabel('Dein Anzeigename');
			await expect(field).toHaveValue('Anna');
			await expect(field).toBeFocused();
		});

		test('shows the field at once when the account has no name', async ({ page }) => {
			await openJoinPage(page, null);
			await expect(page.getByLabel('Dein Anzeigename')).toBeVisible({ timeout: 60_000 });
			await expect(page.getByRole('button', { name: 'Namen ändern' })).toHaveCount(0);
		});
	});

	// Expired, revoked and used-up links all get the same 410 `invite_expired` from the API (see
	// tests/wg-invite-join.test.ts), so one answer covers all three here.
	test.describe('signed-in link that cannot be used', () => {
		const TOKEN = 'fixture-invite-token01';
		const WG = 'Altbau';
		const valid = { status: 200, json: { wg: { name: WG, shareCode: FIXTURE_WG.shareCode } } };
		const gone = { status: 410, json: { error: 'invite_expired', code: 'invite_expired' } };

		async function openSignedIn(
			page: Page,
			lookup: (route: import('@playwright/test').Route) => Promise<void>,
		): Promise<void> {
			await setupMember(page);
			await mockNoWgs(page);
			await page.setViewportSize({ width: 320, height: 780 });
			await page.route(`**/api/wg/invites/${TOKEN}`, lookup);
			await page.goto(`/invite/${TOKEN}`);
		}

		for (const [locale, title, message] of [
			[
				'de',
				'Einladung nicht gültig',
				'Diese Einladung ist nicht mehr gültig. Bitte die Person, die dich eingeladen hat, um einen neuen Link.',
			],
			[
				'en',
				'Invitation not valid',
				'This invitation is no longer valid. Ask the person who invited you to send you a new link.',
			],
			[
				'es',
				'Invitación no válida',
				'Esta invitación ya no es válida. Pide a la persona que te invitó que te envíe un enlace nuevo.',
			],
		] as const) {
			test(`asks for a fresh link from the sender and names no WG (${locale})`, async ({
				page,
				context,
				baseURL,
			}) => {
				await setLocale(context, baseURL ?? '', locale);
				await openSignedIn(page, (route) => route.fulfill(gone));
				await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
				await expect(page.getByText(WG)).toHaveCount(0);
				await expect(page.locator('#join-name')).toHaveCount(0);
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
				);
				expect(overflow).toBeLessThanOrEqual(0);
			});
		}

		for (const [label, fail] of [
			['a server error', (route) => route.fulfill({ status: 503, json: { error: 'db_error' } })],
			['a lost connection', (route) => route.abort('internetdisconnected')],
		] as const satisfies ReadonlyArray<
			readonly [string, (route: import('@playwright/test').Route) => Promise<void>]
		>) {
			test(`${label} offers a retry, not the expired message, and the retry joins`, async ({
				page,
			}) => {
				let failing = true;
				await openSignedIn(page, (route) => (failing ? fail(route) : route.fulfill(valid)));
				await expect(
					page.getByText('Die Einladung konnte gerade nicht geprüft werden.'),
				).toBeVisible({ timeout: 60_000 });
				await expect(page.getByText('nicht mehr gültig')).toHaveCount(0);
				await expect(page.getByRole('button', { name: 'Nachricht kopieren' })).toHaveCount(0);

				failing = false;
				await page.getByRole('button', { name: 'Erneut prüfen', exact: true }).click();
				await expect(
					page.getByRole('heading', { name: `Tritt der WG „${WG}“ bei`, level: 1 }),
				).toBeVisible();
				await page.route('**/api/wg/*/members', (route) =>
					route.request().method() === 'POST'
						? route.fulfill({ json: { member: { id: 'm1', name: 'Lea', role: 'member' } } })
						: route.fallback(),
				);
				await page.getByLabel('Dein Anzeigename').fill('Lea');
				await page.getByRole('button', { name: 'Beitreten', exact: true }).click();
				await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}$`), {
					timeout: 60_000,
				});
			});
		}

		test('a server error while joining keeps the form and is not shown as expired', async ({
			page,
		}) => {
			await openSignedIn(page, (route) => route.fulfill(valid));
			await page.route('**/api/wg/*/members', (route) =>
				route.fulfill({ status: 503, json: { error: 'db_error', code: 'db_error' } }),
			);
			await page.getByLabel('Dein Anzeigename').fill('Lea', { timeout: 60_000 });
			await page.getByRole('button', { name: 'Beitreten', exact: true }).click();
			await expect(
				page.getByText('Beitritt konnte nicht abgeschlossen werden', { exact: false }),
			).toBeVisible();
			await expect(page.getByText('nicht mehr gültig')).toHaveCount(0);
			await expect(page.getByLabel('Dein Anzeigename')).toBeVisible();
		});
	});

	test.describe('guest entry', () => {
		const TOKEN = 'fixture-invite-token01';
		const LONG_NAME = 'Gemeinschaftswohnung Kastanienallee Hinterhaus Dachgeschoss links';

		async function openAsGuest(
			page: Page,
			width: number,
			preview: { status: number; json?: unknown },
		): Promise<void> {
			await setupMember(page);
			await page.setViewportSize({ width, height: 780 });
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({ status: 401, json: { error: 'auth_required', code: 'auth_required' } }),
			);
			await page.route(`**/api/wg/invites/${TOKEN}`, (route) =>
				route.fulfill({ status: 401, json: { error: 'auth_required', code: 'auth_required' } }),
			);
			await page.route(`**/api/wg/invites/${TOKEN}/preview`, (route) => route.fulfill(preview));
			await page.goto(`/invite/${TOKEN}`);
		}

		async function expectNoOverflow(page: Page): Promise<void> {
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
		}

		for (const width of [390, 320]) {
			test(`names the inviter and the WG, long names included, at ${width}px`, async ({ page }) => {
				await openAsGuest(page, width, {
					status: 200,
					json: { wgName: LONG_NAME, inviterName: 'Mika' },
				});
				await expect(
					page.getByRole('heading', {
						name: `Mika lädt dich in die WG „${LONG_NAME}“ ein`,
						level: 1,
					}),
				).toBeVisible({ timeout: 60_000 });
				await expect(
					page.getByRole('link', { name: 'Konto erstellen', exact: true }),
				).toBeVisible();
				await expect(page.getByRole('link', { name: 'Ich habe schon ein Konto' })).toHaveAttribute(
					'href',
					`/login?next=${encodeURIComponent(`/invite/${TOKEN}`)}`,
				);
				await expectNoOverflow(page);
			});

			test(`falls back to the nameless title without an inviter at ${width}px`, async ({
				page,
			}) => {
				await openAsGuest(page, width, {
					status: 200,
					json: { wgName: LONG_NAME, inviterName: null },
				});
				await expect(
					page.getByRole('heading', {
						name: `Du bist in die WG „${LONG_NAME}“ eingeladen`,
						level: 1,
					}),
				).toBeVisible({ timeout: 60_000 });
				await expectNoOverflow(page);
			});

			test(`ends at once on a link that cannot be used at ${width}px`, async ({ page }) => {
				await openAsGuest(page, width, {
					status: 404,
					json: { error: 'invite_unavailable', code: 'invite_unavailable' },
				});
				await expect(
					page.getByRole('heading', { name: 'Einladung nicht gültig', level: 1 }),
				).toBeVisible({ timeout: 60_000 });
				await expect(page.getByRole('link', { name: 'Konto erstellen' })).toHaveCount(0);
				await expectNoOverflow(page);
			});
		}

		test('gives a reason to join and shows how many flatmates are in', async ({ page }) => {
			await openAsGuest(page, 390, {
				status: 200,
				json: { wgName: 'Altbau', inviterName: 'Mika', memberCount: 3 },
			});
			await expect(
				page.getByText('Gemeinsame Ausgaben, Putzplan und Einkaufsliste.', { exact: false }),
			).toBeVisible({ timeout: 60_000 });
			await expect(page.getByText('3 Mitbewohner sind schon dabei')).toBeVisible();
		});

		test('leaves the count out while the inviter is alone', async ({ page }) => {
			await openAsGuest(page, 390, {
				status: 200,
				json: { wgName: 'Altbau', inviterName: 'Mika', memberCount: 1 },
			});
			await expect(page.getByText('Ohne Passwort', { exact: false })).toBeVisible({
				timeout: 60_000,
			});
			await expect(page.getByText('schon dabei')).toHaveCount(0);
		});

		test('an expired link offers a ready-made message to ask for a new one', async ({ page }) => {
			await page.addInitScript(() => {
				const written: string[] = [];
				(window as unknown as { __copied: string[] }).__copied = written;
				Object.defineProperty(navigator, 'clipboard', {
					value: { writeText: async (text: string) => void written.push(text) },
					configurable: true,
				});
			});
			await openAsGuest(page, 390, {
				status: 404,
				json: { error: 'invite_unavailable', code: 'invite_unavailable' },
			});
			await page
				.getByRole('button', { name: 'Nachricht kopieren', exact: true })
				.click({ timeout: 60_000 });
			await expect(page.getByRole('button', { name: 'Kopiert', exact: true })).toBeVisible();
			const copied = await page.evaluate(
				() => (window as unknown as { __copied: string[] }).__copied,
			);
			expect(copied).toEqual([
				'Mein ManaWG-Link funktioniert nicht mehr, schickst du mir bitte einen neuen?',
			]);
		});

		test('shows the message to copy by hand when copying fails', async ({ page }) => {
			await page.addInitScript(() => {
				Object.defineProperty(navigator, 'clipboard', {
					value: { writeText: async () => Promise.reject(new Error('denied')) },
					configurable: true,
				});
				document.execCommand = () => false;
			});
			await openAsGuest(page, 390, {
				status: 404,
				json: { error: 'invite_unavailable', code: 'invite_unavailable' },
			});
			await page
				.getByRole('button', { name: 'Nachricht kopieren', exact: true })
				.click({ timeout: 60_000 });
			await expect(
				page.getByText(
					'Mein ManaWG-Link funktioniert nicht mehr, schickst du mir bitte einen neuen?',
				),
			).toBeVisible();
		});

		test('keeps the generic guest page when the preview is rate limited', async ({ page }) => {
			await openAsGuest(page, 390, { status: 429, json: { error: 'rate_limited' } });
			await expect(page.getByRole('heading', { name: 'Einladung annehmen', level: 1 })).toBeVisible(
				{
					timeout: 60_000,
				},
			);
			await expect(page.getByRole('link', { name: 'Konto erstellen', exact: true })).toBeVisible();
		});
	});
});

// Messenger crawlers run no JavaScript: the server-rendered card has to name the invitation.
test.describe('invitation link preview card', () => {
	skipUnlessFixtures();

	const WHATSAPP = { 'User-Agent': 'WhatsApp/2.23.20.0 A' };
	const ogTitle = (html: string) =>
		html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? null;

	test('a valid link names the inviter and the flat in og:title', async ({ request }) => {
		const res = await request.get('/invite/fixture-invite-token01', { headers: WHATSAPP });
		expect(res.status()).toBe(200);
		const html = await res.text();
		expect(ogTitle(html)).toBe('Mika lädt dich in die WG „Kastanienallee 12“ ein — ManaWG');
		expect(html).toContain('<title>Mika lädt dich in die WG „Kastanienallee 12“ ein');
		expect(html).toContain(
			'<meta property="og:description" content="Mika lädt dich in die WG „Kastanienallee 12“ ein. 2 Mitbewohner sind schon dabei.',
		);
	});

	test('an unknown link keeps the generic card and the same status', async ({ request }) => {
		const res = await request.get('/invite/AAAAAAAAAAAAAAAAAAAAAA', { headers: WHATSAPP });
		expect(res.status()).toBe(200);
		const html = await res.text();
		expect(ogTitle(html)).toBe('Du bist in eine WG eingeladen — ManaWG');
		expect(html).not.toContain('Kastanienallee');
	});
});
