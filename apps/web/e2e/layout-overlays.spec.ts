// Drawers, alert dialogs, back-button dismissal and toasts.
// Why: Overlays must not trap the user or break on zoom.

import { expect, type Locator, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('drawer mobile zoom', () => {
	skipUnlessFixtures();

	const { id: wgId, memberId, memberName, shareCode } = FIXTURE_WG;

	const drawers = [
		{ feature: 'chores', openButton: 'Putzaufgabe hinzufügen' },
		{ feature: 'supplies', openButton: 'Vorrat hinzufügen' },
		{ feature: 'calendar', openButton: 'Termin hinzufügen' },
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
				await page.evaluate((size) => {
					document.documentElement.style.fontSize = `${size}px`;
				}, fontSize);
				await expect
					.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
					.toBe(`${fontSize}px`);

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

test.describe('alert dialog responsive', () => {
	skipUnlessFixtures();

	async function expectAlertDialogLayout(page: Page, dialog: Locator) {
		for (const fontSize of ['16px', '32px']) {
			await page.evaluate((size) => {
				document.documentElement.style.fontSize = size;
			}, fontSize);

			for (const theme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await expect
					.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
					.toBe(theme === 'dark');

				for (const width of [320, 360, 390]) {
					await page.setViewportSize({ width, height: 740 });
					await dialog.evaluate(async (element) => {
						await Promise.all(
							element
								.getAnimations({ subtree: true })
								.map((animation) => animation.finished.catch(() => undefined)),
						);
					});
					const layout = await dialog.evaluate((element) => {
						const measure = (node: Element) => {
							const rect = node.getBoundingClientRect();
							const target = getComputedStyle(node, '::after');
							return {
								left: rect.left,
								right: rect.right,
								width: rect.width,
								clientWidth: node.clientWidth,
								scrollWidth: node.scrollWidth,
								touchWidth: Number.parseFloat(target.width),
								touchHeight: Number.parseFloat(target.height),
							};
						};
						const footer = element.querySelector<HTMLElement>('[data-slot="alert-dialog-footer"]');
						const header = element.querySelector<HTMLElement>('[data-slot="alert-dialog-header"]');
						const text = Array.from(
							element.querySelectorAll<HTMLElement>(
								'[data-slot="alert-dialog-title"], [data-slot="alert-dialog-description"]',
							),
						);
						return {
							rootFontSize: getComputedStyle(document.documentElement).fontSize,
							pageWidth: document.documentElement.scrollWidth,
							dialog: measure(element),
							footer: footer ? measure(footer) : null,
							header: header ? measure(header) : null,
							text: text.map(measure),
							buttons: footer
								? Array.from(footer.querySelectorAll<HTMLElement>('button')).map(measure)
								: [],
						};
					});

					expect(layout.rootFontSize).toBe(fontSize);
					expect(layout.pageWidth).toBeLessThanOrEqual(width);
					expect(layout.dialog.width).toBeLessThanOrEqual(width);
					expect(layout.dialog.scrollWidth).toBeLessThanOrEqual(layout.dialog.clientWidth + 1);
					expect(layout.footer).not.toBeNull();
					expect(layout.header).not.toBeNull();
					if (layout.footer) {
						expect(layout.footer.left).toBeGreaterThanOrEqual(layout.dialog.left - 2);
						expect(layout.footer.right).toBeLessThanOrEqual(layout.dialog.right + 2);
						expect(layout.footer.scrollWidth).toBeLessThanOrEqual(layout.footer.clientWidth + 1);
					}
					for (const item of [...(layout.header ? [layout.header] : []), ...layout.text]) {
						expect(item.right).toBeLessThanOrEqual(layout.dialog.right + 2);
						expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
					}
					for (const button of layout.buttons) {
						expect(button.right).toBeLessThanOrEqual(layout.dialog.right + 2);
						expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
						expect(button.touchWidth).toBeGreaterThanOrEqual(44);
						expect(button.touchHeight).toBeGreaterThanOrEqual(44);
					}
				}
			}
		}
	}

	test('keeps chore and subscription confirmations usable at phone widths and 200% text', async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const shareCode = FIXTURE_WG.shareCode;
		const viewer = {
			id: FIXTURE_WG.memberId,
			name: FIXTURE_WG.memberName,
			color: null,
			active: true,
		};
		const title = 'Aufgabe alert-layout';
		const chore = {
			id: 'alert-layout',
			title,
			intervalDays: 7,
			recurrenceType: 'days',
			nextDueAt: new Date(Date.now() + 3_600_000).toISOString(),
			assignedMemberId: viewer.id,
			lastCompletedAt: null,
			lastCompletedByName: null,
			openGapCountForAssignee: 0,
		};
		const recurringExpense = {
			id: 'alert-layout-recurring',
			description: 'Musik-Abo',
			amountCents: 123456,
			currency: 'EUR',
			paidByMemberId: viewer.id,
			intervalMonths: 1,
			nextDueAt: '2026-10-01T12:00:00.000Z',
			lastCreatedAt: null,
			pausedAt: null,
			splits: [{ debtorMemberId: viewer.id, amountCents: 123456 }],
		};

		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
			route.fulfill({ json: { members: [viewer], viewerIsAdmin: false } }),
		);
		await page.route(`**/api/wg/${shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [chore], monthCompletions: {} } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences*`, (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard*`, (route) =>
			route.fulfill({
				json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] },
			}),
		);
		await page.route(`**/api/wg/${shareCode}/chat/unread-count*`, (route) =>
			route.fulfill({ json: { count: 0, overflow: false } }),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses*`, (route) =>
			route.fulfill({ json: { recurringExpenses: [recurringExpense] } }),
		);

		await page.setViewportSize({ width: 320, height: 740 });
		await navigateToFeature(page, `/wg/${shareCode}/chores`);
		await dismissOnboarding(page);

		const completeTrigger = page.getByRole('button', {
			name: `Als erledigt markieren: ${title}`,
		});
		await completeTrigger.focus();
		await page.keyboard.press('Enter');
		const choreDialog = page.getByRole('alertdialog');
		await expect(choreDialog).toBeVisible();
		await expectAlertDialogLayout(page, choreDialog);
		expect(await choreDialog.evaluate((element) => element.contains(document.activeElement))).toBe(
			true,
		);
		await choreDialog.getByRole('button', { name: 'Abbrechen', exact: true }).focus();
		await page.keyboard.press('Shift+Tab');
		await expect(
			choreDialog.getByRole('button', {
				name: `Erledigt bestätigen: ${title}`,
			}),
		).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(choreDialog).toBeHidden();
		await expect(completeTrigger).toBeFocused();

		await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
		await page.setViewportSize({ width: 320, height: 740 });
		await page.goto(`/wg/${shareCode}/recurring`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: /Details öffnen: Musik-Abo/ }).click();
		const deleteTrigger = page.getByRole('button', { name: 'Musik-Abo löschen' });
		await expect(deleteTrigger).toBeVisible();
		await deleteTrigger.focus();
		await page.keyboard.press('Enter');
		const recurringDialog = page.getByRole('alertdialog');
		await expect(recurringDialog).toBeVisible();
		await expectAlertDialogLayout(page, recurringDialog);
		expect(
			await recurringDialog.evaluate((element) => element.contains(document.activeElement)),
		).toBe(true);
		await page.keyboard.press('Escape');
		await expect(recurringDialog).toBeHidden();
		await expect(deleteTrigger).toBeFocused();
	});
});

test.describe('overlay back dismiss', () => {
	skipUnlessFixtures();

	const { shareCode } = FIXTURE_WG;

	test.use({ hasTouch: true });

	// Record CloseWatchers so the test can fire the close request Android's back
	// gesture would send; Playwright has no system back button.
	async function trackCloseWatchers(page: Page): Promise<void> {
		await page.addInitScript(() => {
			const Native = (window as unknown as { CloseWatcher?: new () => object }).CloseWatcher;
			if (!Native) return;
			const watchers: object[] = [];
			(window as unknown as { __closeWatchers: object[] }).__closeWatchers = watchers;
			(window as unknown as { CloseWatcher: unknown }).CloseWatcher = class extends Native {
				constructor() {
					super();
					watchers.push(this);
				}
			};
		});
	}

	async function pressSystemBack(page: Page): Promise<void> {
		await page.evaluate(() => {
			const watchers = (window as unknown as { __closeWatchers: { requestClose(): void }[] })
				.__closeWatchers;
			watchers.at(-1)?.requestClose();
		});
	}

	// Material 3: the Android back gesture closes an open overlay instead of
	// leaving the page.
	test('system back closes an open drawer instead of leaving the page', async ({ page }) => {
		await trackCloseWatchers(page);
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await page.setViewportSize({ width: 320, height: 640 });
		await navigateToFeature(page, `/wg/${shareCode}/chores`);
		await dismissOnboarding(page);

		const trigger = page.getByRole('button', { name: 'Putzaufgabe hinzufügen', exact: true });
		await trigger.click();
		const drawer = page.getByRole('dialog');
		await expect(drawer).toBeVisible();

		await pressSystemBack(page);

		expect(new URL(page.url()).pathname).toBe(`/wg/${shareCode}/chores`);
		await expect(drawer).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test('system back closes an open alert dialog instead of leaving the page', async ({ page }) => {
		await trackCloseWatchers(page);
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: 'fixture-other-member', name: 'Mira', color: null, active: true },
					],
					viewerIsAdmin: true,
				},
			}),
		);
		await page.setViewportSize({ width: 320, height: 640 });
		await navigateToFeature(page, `/wg/${shareCode}/settings#access`);
		await dismissOnboarding(page);

		const trigger = page.getByRole('button', { name: 'Komplette WG für alle löschen' });
		await trigger.click();
		const alertDialog = page.getByRole('alertdialog', { name: 'WG dauerhaft löschen?' });
		await expect(alertDialog).toBeVisible();

		await pressSystemBack(page);

		expect(new URL(page.url()).pathname).toBe(`/wg/${shareCode}/settings`);
		await expect(alertDialog).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	// A history-based back handler once cancelled this navigation.
	test('closing an overlay keeps the navigation it started', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/imports/preview`, (route) =>
			route.fulfill({
				json: {
					parsed: [
						{
							date: '2026-09-25T00:00:00.000Z',
							description: 'Wocheneinkauf',
							amountCents: 1200,
							currency: 'EUR',
							paidByName: FIXTURE_WG.memberName,
							splits: [{ memberName: FIXTURE_WG.memberName, amountCents: 1200 }],
							warnings: [],
						},
					],
					payloadHash: 'overlay-navigation',
					memberMapping: { [FIXTURE_WG.memberName]: FIXTURE_WG.memberId },
					conflicts: [],
					members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName }],
				},
			}),
		);
		await page.setViewportSize({ width: 320, height: 640 });
		await navigateToFeature(page, `/wg/${shareCode}/import`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: /Splitwise CSV/ }).click();
		await page.getByText('Oder Inhalt einfügen', { exact: true }).click();
		await page.getByRole('textbox', { name: 'Inhalt des Exports' }).fill('fixture export');
		await page.getByRole('button', { name: 'Vorschau erstellen', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Namen WG-Mitgliedern zuordnen' }),
		).toBeVisible();

		await page.getByRole('link', { name: 'Ausgaben' }).first().click();
		await page.getByRole('button', { name: 'Verwerfen' }).click();

		await expect(page).toHaveURL(new RegExp(`/wg/${shareCode}/expenses$`));
		await page.waitForTimeout(1000);
		await expect(page).toHaveURL(new RegExp(`/wg/${shareCode}/expenses$`));
	});
});

test.describe('toast pause on hover', () => {
	skipUnlessFixtures();
	test.use({ hasTouch: true, isMobile: true });

	// WCAG 2.2.1 (Timing Adjustable): an auto-dismissing toast must pause while the
	// user is hovering or focusing it, and only resume counting down afterwards.
	// The error toast's dismiss timer (Toast.tsx: ERROR_TOAST_DURATION_MS = 8000) must be
	// pausable; this test fails if it degrades to a single un-pausable setTimeout.
	const TOAST_DURATION_MS = 8000;
	const PAST_DURATION_MS = TOAST_DURATION_MS + 400;

	test('a toast pauses its auto-dismiss timer while hovered or focused', async ({ page }) => {
		const recurringExpense = {
			id: 'recurring-netflix',
			description: 'Netflix',
			amountCents: 1499,
			currency: 'EUR',
			paidByMemberId: FIXTURE_WG.memberId,
			intervalMonths: 1,
			nextDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
			lastCreatedAt: null,
			pausedAt: null,
			splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1499 }],
		};

		// Fake timers let the test jump past the dismiss delay instead of sleeping.
		await page.clock.install();
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses`, (route) => {
			if (route.request().method() === 'GET') {
				return route.fulfill({ json: { recurringExpenses: [recurringExpense] } });
			}
			return route.continue();
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses/*`, (route) => {
			if (route.request().method() === 'DELETE') {
				return route.fulfill({ status: 500, json: { error: 'delete_failed' } });
			}
			return route.continue();
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/recurring`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: /^Details öffnen: Netflix/ }).click();
		await page.getByRole('button', { name: 'Netflix löschen' }).click();
		await page.getByRole('button', { name: 'Löschen' }).last().click();

		const toast = page
			.getByRole('region', { name: 'Benachrichtigungen' })
			.getByRole('alert')
			.filter({ hasText: 'Fixkosten konnten nicht gelöscht werden' });
		await expect(toast).toBeVisible();
		const closeButton = toast.getByRole('button', { name: 'Benachrichtigung schließen' });

		// WCAG 2.4.3 (Focus Order): the toast stack must sit after the bottom nav
		// in the DOM so Tab reaches a toast's dismiss button right after whatever
		// the user just did, instead of jumping back to the page top.
		const navHandle = await page
			.getByRole('navigation', { name: 'WG Hauptnavigation' })
			.elementHandle();
		const toastComesAfterNav = await toast.evaluate((toastEl, navEl) => {
			// Node.DOCUMENT_POSITION_FOLLOWING = 4: navEl precedes toastEl in the DOM.
			if (!navEl) return false;
			return Boolean(navEl.compareDocumentPosition(toastEl) & 4);
		}, navHandle);
		expect(toastComesAfterNav).toBe(true);

		// Hover pause: still visible well past the normal auto-dismiss point.
		await toast.hover();
		await page.clock.runFor(PAST_DURATION_MS);
		await expect(toast).toBeVisible();

		// Leaving restarts a fresh countdown; focusing the close button before it
		// elapses must pause it again.
		await page.mouse.move(5, 5);
		await closeButton.focus();
		await page.clock.runFor(PAST_DURATION_MS);
		await expect(toast).toBeVisible();

		// Blurring resumes the timer, which then dismisses the toast normally.
		await closeButton.evaluate((el) => el.blur());
		await page.clock.runFor(PAST_DURATION_MS);
		await expect(toast).toBeHidden();
	});
});
