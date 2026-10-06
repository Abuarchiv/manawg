// Settings controls: pending switches never double-submit, tab focus is not obscured, the theme
// choice applies, and the share card and invite code copy work.

import { expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockNoWgs,
	navigateToFeature,
	setupMember,
} from './_helpers';
import { applyRootTextScale } from './support/text-scale';

test.describe('settings pending switches', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('notification switches reject additional changes until the pending save completes', async ({
		page,
	}) => {
		await setupMember(page);
		const status = {
			pushOptIn: false,
			pushConfigured: true,
			notifyAnnouncements: true,
			notifyChores: true,
			notifyExpenses: true,
			notifyReminders: true,
			notifyShopping: true,
			notifyInventory: true,
			notifyChat: true,
			notifyEvents: true,
			quietStartHour: null,
			quietEndHour: null,
		};
		let releaseSave = () => {};
		const saveGate = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		const patches: unknown[] = [];
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/notifications`, async (route) => {
			if (route.request().method() !== 'PATCH') return route.fulfill({ json: status });
			patches.push(route.request().postDataJSON());
			await saveGate;
			return route.fulfill({ json: { ok: true } });
		});
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#benachrichtigungen`);
		const chores = page.getByRole('switch', { name: 'Putzplan', exact: true });
		const expenses = page.getByRole('switch', { name: 'Ausgaben', exact: true });
		const push = page.getByRole('switch', { name: 'Web Push aktivieren', exact: true });
		await expect(chores).toBeEnabled();
		// Regression: the switch's <button> render target must declare type="button" (via
		// nativeButton), otherwise it silently defaults to type="submit" and would submit
		// any enclosing <form> on activation.
		await expect(chores).toHaveAttribute('type', 'button');
		await expect(expenses).toBeChecked();
		const originalThumbPosition = await expenses
			.locator('[data-slot="switch-thumb"]')
			.evaluate((thumb) => getComputedStyle(thumb).left);
		await chores.click();
		// A quick tap still plays the liquid-glass lift before the thumb settles.
		await expect(chores.locator('[data-slot="switch-thumb"]')).toHaveAttribute('data-pressed', '');
		try {
			await expect.poll(() => patches.length).toBe(1);
			await expect(chores).toBeDisabled();
			await expect(expenses).toBeDisabled();
			await expect(push).toBeDisabled();
			// Native activation must not move the thumb while its save handler is locked.
			await expenses.evaluate((button) => (button as HTMLButtonElement).click());
			await expect(expenses).toBeChecked();
		} finally {
			releaseSave();
		}
		await expect(chores).toBeEnabled();
		await expect(chores).not.toBeChecked();
		await expect(chores.locator('[data-slot="switch-thumb"]')).not.toHaveAttribute('data-pressed');
		await expect(expenses).toBeEnabled();
		await expect(expenses).toBeChecked();
		await expect(expenses.locator('[data-slot="switch-thumb"]')).toHaveCSS(
			'left',
			originalThumbPosition,
		);
		expect(patches).toEqual([{ notifyChores: false }]);
		// iOS 26 geometry: checked thumb 2.5px inside the right edge, vertically centred.
		const [button, thumb] = await Promise.all([
			expenses.boundingBox(),
			expenses.locator('[data-slot="switch-thumb"]').boundingBox(),
		]);
		if (!button || !thumb) throw new Error('switch not rendered');
		expect(button.x + button.width - (thumb.x + thumb.width)).toBeCloseTo(2.5, 1);
		expect(button.y + button.height / 2 - (thumb.y + thumb.height / 2)).toBeCloseTo(0, 1);
	});
});

test.describe('settings tabs focus obscured', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	// WCAG 2.4.11: the settings page's sticky tab strip (TabsList) must not cover
	// content that gets scrolled/focused into view right beneath it, e.g. when a
	// user tabs backward (Shift+Tab) into the panel.
	test('sticky settings tab strip keeps focused content clear', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 640 });
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		await dismissOnboarding(page);

		const target = page.getByRole('button', { name: 'Einladungslink kopieren' });
		await expect(target).toBeVisible();
		await page.waitForLoadState('networkidle');

		// Park the target right under the tab strip: still inside the viewport, so
		// focus only scrolls it clear if scroll-padding marks the strip as obscured.
		await target.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 10));
		await target.focus();

		const tabsBox = await page.getByRole('tablist').boundingBox();
		const targetBox = await target.boundingBox();
		if (!tabsBox || !targetBox) throw new Error('tab strip or target not measurable');
		const tabsBottom = tabsBox.y + tabsBox.height;
		expect(targetBox.y).toBeGreaterThanOrEqual(tabsBottom);
	});
});

test.describe('settings theme responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.use({ viewport: { width: 320, height: 720 }, bypassCSP: true });

	test('all theme choices stay reachable at 320px with 200% text', async ({ page }) => {
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await expect(page.getByRole('button', { name: 'System', exact: true })).toBeVisible();
		await applyRootTextScale(page, 200);
		expect(
			await page.locator('html').evaluate((element) => getComputedStyle(element).fontSize),
		).toBe('32px');
		for (const tab of await page.getByRole('tab').all()) {
			const box = await tab.boundingBox();
			expect(box?.width).toBeGreaterThanOrEqual(112);
		}

		for (const name of ['Hell', 'Dunkel', 'System']) {
			const choice = page.getByRole('button', { name, exact: true });
			await expect(choice).toBeVisible();
			const box = await choice.boundingBox();
			if (!box) throw new Error(`${name} has no layout box`);
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(320);
		}
		for (const name of ['Hell', 'Dunkel', 'System']) {
			const choice = page.getByRole('button', { name, exact: true });
			await choice.click();
			await expect(choice).toHaveAttribute('aria-pressed', 'true');
			if (name === 'Dunkel') await expect(page.locator('html')).toHaveClass(/dark/);
			if (name === 'Hell') await expect(page.locator('html')).not.toHaveClass(/dark/);
		}
	});

	test('admin can rename the WG from the profile tab and sees API failures', async ({ page }) => {
		await setupMember(page);
		await page.route('**/api/wg/*/members', (route) =>
			route.fulfill({
				json: {
					members: [
						{
							id: FIXTURE_WG.memberId,
							name: FIXTURE_WG.memberName,
							color: '#6d5efc',
							active: true,
						},
					],
					viewerIsAdmin: true,
				},
			}),
		);
		let status = 500;
		let sentName: string | undefined;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			sentName = route.request().postDataJSON().name;
			return route.fulfill({ status, json: { wg: { name: sentName } } });
		});
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		const name = page.getByLabel('Name eurer WG');
		const save = page.getByRole('button', { name: 'Speichern', exact: true });
		await expect(save).toBeDisabled();
		await name.fill('  Neue WG ');
		await save.click();
		await expect(page.getByText(/nicht umbenannt werden/)).toBeVisible();
		await expect(name).toHaveValue('  Neue WG ');
		status = 200;
		await name.press('Enter');
		await expect(page.getByText('WG-Name gespeichert.')).toBeVisible();
		expect(sentName).toBe('Neue WG');
	});
});

test.describe('share card', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('native share success does not mark the invite link as copied', async ({ page }) => {
		// Stub the Web Share API so `nativeShare()` takes its success branch instead
		// of falling back to clipboard copy.
		await page.addInitScript(() => {
			Object.defineProperty(window.navigator, 'share', {
				configurable: true,
				value: () => Promise.resolve(),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);

		const linkButton = page.getByRole('button', { name: 'Einladungslink kopieren' });
		await expect(linkButton).toBeVisible();
		const shareButton = page.getByRole('button', { name: 'WG-Einladung teilen' });
		await shareButton.click();

		// A real share (not a clipboard copy) must not relabel the link row or
		// swap its icon to a checkmark — nothing was copied.
		await expect(page.getByRole('button', { name: 'Link kopiert' })).toHaveCount(0);
		await expect(linkButton).toBeVisible();

		// The generic "ready" note is still fine to show after a successful share.
		await expect(page.getByText('Einladungslink bereit.')).toBeVisible();
	});

	test('deactivating another member shows their open balances and succeeds', async ({ page }) => {
		const otherMember = { id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina' };
		await setupMember(page);

		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			return route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: otherMember.id, name: otherMember.name, color: null, active: true },
					],
					viewerIsAdmin: true,
				},
			});
		});
		await page.route(
			`**/api/wg/${FIXTURE_WG.shareCode}/members/${otherMember.id}`,
			async (route) => {
				const method = route.request().method();
				if (method === 'GET') {
					return route.fulfill({
						json: {
							member: { id: otherMember.id, name: otherMember.name, active: true },
							openBalances: [
								{
									member_id: FIXTURE_WG.memberId,
									name: FIXTURE_WG.memberName,
									amount_cents: 1250,
									currency: 'EUR',
									direction: 'owed',
								},
							],
						},
					});
				}
				if (method === 'PATCH') {
					return route.fulfill({
						json: { member: { id: otherMember.id, name: otherMember.name, active: false } },
					});
				}
				return route.fallback();
			},
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		await page.getByRole('button', { name: `Ausziehen: ${otherMember.name}` }).click();

		await expect(
			page.getByRole('heading', { name: `${otherMember.name} ausziehen?` }),
		).toBeVisible();
		// direction "owed" from Mina's perspective: the viewer (dsaf) owes her.
		await expect(page.getByText(`${FIXTURE_WG.memberName} schuldet`)).toBeVisible();

		const confirmButton = page.getByRole('button', { name: 'Ausziehen', exact: true });
		await expect(confirmButton).toBeEnabled();
		await confirmButton.click();

		await expect(
			page.getByText(`${otherMember.name} ist jetzt als ausgezogen markiert.`),
		).toBeVisible();
	});

	test('reactivating a former member keeps their name at the start of the accessible label', async ({
		page,
	}) => {
		const otherMember = { id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina' };
		await setupMember(page);

		let reactivated = false;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			return route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: otherMember.id, name: otherMember.name, color: null, active: reactivated },
					],
					viewerIsAdmin: true,
				},
			});
		});
		await page.route(
			`**/api/wg/${FIXTURE_WG.shareCode}/members/${otherMember.id}`,
			async (route) => {
				if (route.request().method() !== 'PATCH') return route.fallback();
				reactivated = true;
				return route.fulfill({
					json: { member: { id: otherMember.id, name: otherMember.name, active: true } },
				});
			},
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		await expect(page.getByText('Ausgezogen, Verlauf bleibt erhalten')).toBeVisible();
		// WCAG 2.5.3 — the visible "Aktivieren" label must stay at the start of the
		// accessible name, disambiguated by the affected member's name.
		await page
			.getByRole('button', { name: `Aktivieren: ${otherMember.name}`, exact: true })
			.click();

		await expect(page.getByText(`${otherMember.name} ist wieder aktiv.`)).toBeVisible();
	});

	test('cancelling "WG verlassen" returns focus to its button', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			return route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina', color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			});
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		const leave = page.getByRole('button', { name: 'WG verlassen', exact: true });
		await leave.click();

		// WCAG 2.5.3 — the visible "Abbrechen"/"Verlassen" labels must stay at the
		// start of the accessible name, disambiguated by the self-leave action.
		const cancel = page.getByRole('button', { name: 'Abbrechen: WG verlassen', exact: true });
		await expect(cancel).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Verlassen: WG verlassen', exact: true }),
		).toBeVisible();
		await cancel.click();

		await expect(leave).toBeFocused();
	});
});

test.describe('invite code copy', () => {
	test.describe('invite code copy feedback', () => {
		test.skip(
			process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
			'Requires the local database-down fixture server.',
		);

		test('announces a copied code without reporting that the invitation link was copied', async ({
			page,
		}) => {
			const code = 'MTE8PZAT';
			await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
			await page.addInitScript(() => window.localStorage.clear());
			await mockNoWgs(page);
			await page.route('**/api/wg', async (route) => {
				if (route.request().method() === 'POST') {
					await route.fulfill({
						json: {
							wg: { id: 'fixture', shareCode: code, name: 'Fixture WG' },
							creator: { id: 'fixture-user', name: 'Anna' },
						},
					});
					return;
				}
				await route.continue();
			});

			await page.goto('/neu');
			await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
			await page.getByLabel('WG-Name').fill('Fixture WG');
			await page.getByLabel('Dein Anzeigename').fill('Anna');
			await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();

			const copyCodeButton = page.getByRole('button', {
				name: `Code ${code} kopieren`,
				exact: true,
			});
			await expect(copyCodeButton).toBeVisible();
			await copyCodeButton.focus();
			await expect(copyCodeButton).toBeFocused();
			await page.keyboard.press('Enter');

			await expect(page.locator('#share-status-live')).toHaveText('WG-Code wurde kopiert.');
			await expect(
				page.getByRole('button', { name: 'Mitbewohner einladen', exact: true }),
			).toBeVisible();
			await expect(page.getByText('Code kopiert', { exact: true })).toBeVisible();
			await expect(page.getByText('Link kopiert', { exact: true })).toHaveCount(0);
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
		});
	});
});
