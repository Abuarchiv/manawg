// Invitation flow (fixture lane): a creator gets a personal link, the link opens the join page, joining lands in the WG.
// Why: the share code is only the WG's address; the link is the only way in.

import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_WG, mockNoWgs, setupMember, skipUnlessFixtures } from './support/helpers';

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
				'Mein ManaWG-Link ist abgelaufen, schickst du mir bitte einen neuen?',
			]);
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
