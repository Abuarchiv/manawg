// App shell: the entry frame and public header reflow without overflow, create and invitation
// intents survive signing out, and drawers stay usable at large text on a narrow phone.

import { type Page, expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockNoWgs,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
} from './_helpers';
import { applyRootTextScale } from './support/text-scale';

test.describe('entry frame overflow', () => {
	test.describe('entry headings on narrow screens', () => {
		test.skip(
			process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
			'Requires the local database-down fixture server.',
		);

		test('wraps an unbroken WG name at handset widths and 32px text', async ({ page }) => {
			const wgName = 'Donaudampfschifffahrtsgesellschaftskapitänswohngemeinschaft';
			await page.setViewportSize({ width: 320, height: 780 });
			await page.addInitScript(() => window.localStorage.clear());
			await mockNoWgs(page);
			await page.route('**/api/wg', async (route) => {
				if (route.request().method() === 'POST') {
					await route.fulfill({
						json: {
							wg: { id: 'fixture', shareCode: 'MTE8PZAT', name: wgName },
							creator: { id: 'fixture-user', name: 'Anna' },
						},
					});
					return;
				}
				await route.continue();
			});

			await page.goto('/neu');
			await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
			await page.getByLabel('WG-Name').fill(wgName);
			await page.getByLabel('Dein Anzeigename').fill('Anna');
			await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();

			const heading = page.getByRole('heading', { name: wgName, exact: true, level: 1 });
			await expect(heading).toBeVisible();

			for (const width of [320, 360]) {
				for (const fontSize of [26, 32]) {
					for (const colorScheme of ['light', 'dark'] as const) {
						await page.setViewportSize({ width, height: 780 });
						await page.emulateMedia({ colorScheme });
						await expect
							.poll(() =>
								page.locator('html').evaluate((element) => element.classList.contains('dark')),
							)
							.toBe(colorScheme === 'dark');
						await heading.evaluate((element, size) => {
							(element as HTMLElement).style.fontSize = `${size}px`;
						}, fontSize);
						const layout = await heading.evaluate((element) => {
							const style = getComputedStyle(element);
							const rect = element.getBoundingClientRect();
							return {
								documentWidth: document.documentElement.scrollWidth,
								viewportWidth: window.innerWidth,
								headingRight: rect.right,
								headingHeight: rect.height,
								lineHeight: Number.parseFloat(style.lineHeight),
							};
						});

						expect(
							layout.documentWidth,
							`${width}px, ${fontSize}px, ${colorScheme}`,
						).toBeLessThanOrEqual(layout.viewportWidth);
						expect(
							layout.headingRight,
							`${width}px, ${fontSize}px, ${colorScheme}`,
						).toBeLessThanOrEqual(layout.viewportWidth);
						expect(layout.headingHeight).toBeGreaterThan(layout.lineHeight);
					}
				}
			}
		});
	});
});

test.describe('public header reflow', () => {
	test('public brand and account links reflow on narrow pages', async ({ page }) => {
		await page.route('**/api/wg/mine', (route) =>
			route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: '{"error":"auth_required"}',
			}),
		);

		const layoutFailures: string[] = [];
		for (const path of ['/', '/entdecken/kalender']) {
			await page.goto(path);
			const brand = page.getByRole('link', { name: 'ManaWG Startseite', exact: true });
			const account = page.getByRole('link', { name: 'Anmelden', exact: true });
			await expect(brand).toHaveAttribute('href', '/');
			await expect(account).toHaveAttribute('href', '/neu');

			for (const width of [320, 360, 390]) {
				await page.setViewportSize({ width, height: 844 });
				for (const scheme of ['light', 'dark'] as const) {
					await page.emulateMedia({ colorScheme: scheme });
					await expect
						.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
						.toBe(scheme === 'dark');
					for (const rootFontSize of [16, 32]) {
						await applyRootTextScale(page, (rootFontSize / 16) * 100);
						await page.evaluate(() => document.fonts.ready);
						await expect(account).toBeVisible();

						const metrics = await page.evaluate(() => {
							const brandLink = document.querySelector<HTMLAnchorElement>(
								'a[aria-label="ManaWG Startseite"]',
							);
							const accountLink = [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
								(link) => link.textContent?.trim() === 'Anmelden',
							);
							if (!brandLink || !accountLink) return null;
							const brandRect = brandLink.getBoundingClientRect();
							const accountRect = accountLink.getBoundingClientRect();
							return {
								viewportWidth: window.innerWidth,
								documentWidth: Math.max(
									document.documentElement.scrollWidth,
									document.body.scrollWidth,
								),
								brandRight: brandRect.right,
								accountRight: accountRect.right,
								overlap:
									brandRect.right > accountRect.left &&
									accountRect.right > brandRect.left &&
									brandRect.bottom > accountRect.top &&
									accountRect.bottom > brandRect.top,
							};
						});
						const label = `${path} ${width}px root ${rootFontSize}px ${scheme}`;
						if (!metrics) {
							layoutFailures.push(`${label}: header links missing`);
							continue;
						}
						if (
							metrics.documentWidth > metrics.viewportWidth ||
							metrics.brandRight > width ||
							metrics.accountRight > width ||
							metrics.overlap
						) {
							layoutFailures.push(`${label}: ${JSON.stringify(metrics)}`);
						}
					}
				}
			}

			await page.setViewportSize({ width: 320, height: 844 });
			await page.emulateMedia({ colorScheme: 'dark' });
			await applyRootTextScale(page, 200);
			await brand.focus();
			await page.keyboard.press('Tab');
			await expect(account).toBeFocused();
		}

		expect(layoutFailures).toEqual([]);
	});
});

test.describe('app shell state', () => {
	test.describe('app shell navigation state', () => {
		test('restores create intent from the URL after signing out', async ({ page }) => {
			test.skip(
				!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
				'Requires the configured Supabase browser client.',
			);

			await mockNoWgs(page);

			await page.goto('/neu?action=create');
			await page.getByRole('button', { name: 'Mit anderem Konto anmelden', exact: true }).click();

			await expect(
				page.getByText('Melde dich an, danach erstellst du deine neue WG.'),
			).toBeVisible();
		});

		test('restores invitation intent from the URL after signing out', async ({ page }) => {
			test.skip(
				!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
				'Requires the configured Supabase browser client.',
			);

			await mockNoWgs(page);

			await page.goto(`/neu?code=${FIXTURE_WG.shareCode}`);
			await page.getByRole('button', { name: 'Mit anderem Konto anmelden', exact: true }).click();

			await expect(
				page.getByText('Melde dich an, um mit deinem WG-Code beizutreten.'),
			).toBeVisible();
		});

		test('lets a signed-in single-WG user open that WG from a module preview', async ({ page }) => {
			test.skip(
				process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
				'Requires the database-down fixture server.',
			);

			await setupMember(page);
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						wgs: [{ id: FIXTURE_WG.id, code: FIXTURE_WG.shareCode, name: 'Meine WG' }],
					}),
				}),
			);

			await page.goto('/entdecken/einkauf');
			const openWg = page.getByRole('link', { name: 'WG öffnen', exact: true });
			await expect(openWg).toBeVisible();
			await openWg.click();
			await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}$`));
		});

		test('opens the WG chooser from a module preview with an invitation query', async ({
			page,
		}) => {
			test.skip(
				process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
				'Requires the database-down fixture server.',
			);

			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						wgs: [
							{ id: FIXTURE_WG.id, code: FIXTURE_WG.shareCode, name: 'Meine WG' },
							{ id: 'second-wg', code: 'ABCDEFGH', name: 'Zweite WG' },
						],
					}),
				}),
			);

			await page.goto(`/entdecken/einkauf?code=${FIXTURE_WG.shareCode}`);
			const openWgs = page.getByRole('link', { name: 'Deine WGs', exact: true });
			await expect(openWgs).toBeVisible();
			await openWgs.click();
			await expect(page).toHaveURL('/');
			await expect(page.getByRole('heading', { name: 'Deine WGs', exact: true })).toBeVisible();
			await expect(page.getByText('Zweite WG', { exact: true })).toBeVisible();
		});
	});
});

test.describe('drawer mobile zoom', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const { id: wgId, memberId, memberName, shareCode } = FIXTURE_WG;

	const drawers = [
		{ feature: 'putzen', openButton: 'Putzaufgabe hinzufügen' },
		{ feature: 'vorraete', openButton: 'Vorrat hinzufügen' },
		{ feature: 'kalender', openButton: 'Termin hinzufügen' },
	] as const;

	async function mockHouseholdData(page: Page): Promise<void> {
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: memberId, name: memberName, color: null, active: true },
						{ id: wgId, name: 'Mina', color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences`, (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/inventory`, (route) =>
			route.fulfill({ json: { items: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/events**`, (route) =>
			route.fulfill({ json: { events: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);
	}

	for (const drawerCase of drawers) {
		test(`${drawerCase.feature} drawer stays usable at large text on a narrow phone`, async ({
			page,
		}) => {
			test.setTimeout(120_000);
			await setupMember(page);
			await mockHouseholdData(page);
			await page.setViewportSize({ width: 320, height: 640 });
			await navigateToFeature(page, `/wg/${shareCode}/${drawerCase.feature}`);
			await dismissOnboarding(page);
			await page.getByRole('button', { name: drawerCase.openButton, exact: true }).first().click();

			const drawer = page.getByRole('dialog');
			await expect(drawer).toBeVisible();
			const footer = drawer.locator('[data-slot="drawer-footer"]');
			const fields = drawer.locator(
				'input:visible:not([type="checkbox"]), textarea:visible, select:visible',
			);
			await expect(fields.first()).toBeVisible();
			await expect(footer.getByRole('button').first()).toHaveAccessibleName(/.+/);

			for (const fontSize of [32, 16]) {
				await applyRootTextScale(page, (fontSize / 16) * 100);

				for (const height of [640, 812]) {
					await page.setViewportSize({ width: 320, height });
					for (const theme of ['light', 'dark'] as const) {
						await page.emulateMedia({ colorScheme: theme });
						await expect
							.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
							.toBe(theme === 'dark');

						const firstField = fields.first();
						const lastField = fields.last();
						await firstField.focus();
						await page.keyboard.press('Tab');
						expect(
							await drawer.evaluate((element) => element.contains(document.activeElement)),
						).toBe(true);
						await lastField.focus();
						await expect(lastField).toBeInViewport();

						if (fontSize === 32 && height === 640) {
							const scroll = await lastField.evaluate((field) => {
								let parent = field.parentElement;
								while (parent) {
									const overflowY = getComputedStyle(parent).overflowY;
									if (
										(overflowY === 'auto' || overflowY === 'scroll') &&
										parent.scrollHeight > parent.clientHeight
									) {
										return {
											clientHeight: parent.clientHeight,
											scrollHeight: parent.scrollHeight,
											scrollTop: parent.scrollTop,
										};
									}
									parent = parent.parentElement;
								}
								return null;
							});
							expect(scroll).not.toBeNull();
							expect(scroll?.scrollHeight).toBeGreaterThan(scroll?.clientHeight ?? 0);
							expect(scroll?.scrollTop).toBeGreaterThan(0);
						}

						for (const button of await footer.getByRole('button').all()) {
							await expect(button).toHaveAccessibleName(/.+/);
							await button.focus();
							await expect(button).toBeInViewport({ ratio: 1 });
						}
					}
				}
			}
		});
	}
});
