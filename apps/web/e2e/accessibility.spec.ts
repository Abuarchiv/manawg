// Accessibility: contrast tokens, forced-colors focus, label-in-name, Enter-key hints/next field.
// Why: WCAG 2.2 targets (contrast, focus, label-in-name) are legal/UX requirements and regress via styling changes.

import { expect, type Locator, type Page, test } from '@playwright/test';
import { sampleBoundaryContrast } from './support/contrast';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockNoWgs,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('contrast tokens', () => {
	skipUnlessFixtures();

	const notificationStatus = {
		pushOptIn: false,
		pushConfigured: true,
		notifyAnnouncements: true,
		notifyChores: true,
		notifyExpenses: false,
		notifyReminders: true,
		notifyShopping: true,
		notifyInventory: true,
		notifyChat: true,
		notifyEvents: true,
		notifyStatementEmail: true,
		quietStartHour: null,
		quietEndHour: null,
	};

	for (const scheme of ['light', 'dark'] as const) {
		test(`text input border meets 3:1 non-text contrast in ${scheme}`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await setupMember(page);
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, (route) =>
				route.fulfill({ json: { items: [] } }),
			);
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
			const input = page.getByRole('textbox', { name: 'Artikel-Name' });
			await expect(input).toBeVisible();

			const resting = await page.evaluate(sampleBoundaryContrast, {
				selector: '[aria-label="Artikel-Name"]',
				prop: 'borderTopColor' as const,
			});
			expect(resting.ratio, JSON.stringify(resting)).toBeGreaterThanOrEqual(3);

			await input.focus();
			const focused = await page.evaluate(sampleBoundaryContrast, {
				selector: '[aria-label="Artikel-Name"]',
				prop: 'borderTopColor' as const,
			});
			expect(focused.ratio, JSON.stringify(focused)).toBeGreaterThanOrEqual(3);
		});

		test(`destructive alert description meets 4.5:1 text contrast in ${scheme}`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme: scheme });
			await setupMember(page);
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, (route) =>
				route.request().method() === 'GET'
					? route.fulfill({ json: { items: [] } })
					: route.fulfill({ status: 500, json: { error: 'internal' } }),
			);
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
			await dismissOnboarding(page);
			await page.getByLabel('Artikel-Name').fill('Brot');
			await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();
			await expect(page.locator('#shopping-add-error')).toBeVisible();

			const text = await page.evaluate(sampleBoundaryContrast, {
				selector: '#shopping-add-error [data-slot="alert-description"]',
				prop: 'color' as const,
			});
			expect(text.ratio, JSON.stringify(text)).toBeGreaterThanOrEqual(4.5);
		});

		test(`the month calendar marks today with at least 3:1 against the card in ${scheme}`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme: scheme });
			await setupMember(page);
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
				route.fulfill({ json: { events: [] } }),
			);
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
				route.fulfill({ json: { chores: [] } }),
			);
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/calendar-subscription*`, (route) =>
				route.fulfill({ json: { subscription: null } }),
			);
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
			await dismissOnboarding(page);
			await page.getByRole('tab', { name: 'Monat' }).click();
			const today = page.locator('[aria-current=date] > span');
			await expect(today).toBeVisible();

			await expect(today).toHaveCSS('border-top-width', '1px');
			const marker = await page.evaluate(sampleBoundaryContrast, {
				selector: '[aria-current=date] > span',
				prop: 'borderTopColor' as const,
			});
			expect(marker.ratio, JSON.stringify(marker)).toBeGreaterThanOrEqual(3);
		});

		test(`switch track/thumb meet 3:1 non-text contrast in ${scheme}`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await setupMember(page);
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/notifications`, (route) =>
				route.fulfill({ json: notificationStatus }),
			);
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/settings#notifications`);
			const checked = page.getByRole('switch', { name: 'Putzplan', exact: true });
			const unchecked = page.getByRole('switch', { name: 'Ausgaben', exact: true });
			await expect(checked).toBeChecked();
			await expect(unchecked).not.toBeChecked();
			await expect(checked).toBeEnabled();
			await expect(unchecked).toBeEnabled();
			await Promise.all(
				[checked, unchecked].map((control) =>
					control.evaluate(async (element) => {
						await Promise.all(
							element
								.getAnimations({ subtree: true })
								.map((animation) => animation.finished.catch(() => undefined)),
						);
					}),
				),
			);

			for (const [label, expectChecked] of [
				['Putzplan', true],
				['Ausgaben', false],
			] as const) {
				const track = await page.evaluate(sampleBoundaryContrast, {
					selector: `[aria-label="${label}"]`,
					pseudo: '::before',
					prop: 'backgroundColor' as const,
				});
				expect(
					track.ratio,
					`${label} (checked=${expectChecked}) track: ${JSON.stringify(track)}`,
				).toBeGreaterThanOrEqual(3);

				const thumb = await page.evaluate(sampleBoundaryContrast, {
					selector: `[aria-label="${label}"] [data-slot="switch-thumb"]`,
					prop: 'backgroundColor' as const,
					against: { selector: `[aria-label="${label}"]`, pseudo: '::before' },
				});
				expect(
					thumb.ratio,
					`${label} (checked=${expectChecked}) thumb: ${JSON.stringify(thumb)}`,
				).toBeGreaterThanOrEqual(3);
			}
		});
	}
});

test.describe('forced colors focus', () => {
	skipUnlessFixtures();

	async function expectSystemFocusRing(page: Page, target: Locator): Promise<void> {
		const styles = await target.evaluate((element) => {
			const { outlineColor, outlineOffset, outlineStyle, outlineWidth } = getComputedStyle(element);
			return { outlineColor, outlineOffset, outlineStyle, outlineWidth };
		});
		const highlight = await page.evaluate(() => {
			const sample = document.createElement('span');
			sample.style.color = 'Highlight';
			document.body.append(sample);
			const color = getComputedStyle(sample).color;
			sample.remove();
			return color;
		});

		expect(styles).toMatchObject({
			outlineColor: highlight,
			outlineOffset: '2px',
			outlineStyle: 'solid',
		});
		expect(Number.parseFloat(styles.outlineWidth)).toBeGreaterThanOrEqual(3);
	}

	test('keeps keyboard focus visible in Windows high contrast on shared controls and WG actions', async ({
		page,
		browserName,
	}) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores`, (route) =>
			route.fulfill({
				json: {
					chores: [
						{
							id: 'chore-bath',
							title: 'Bad putzen',
							intervalDays: 7,
							recurrenceType: 'days',
							nextDueAt: new Date().toISOString(),
							assignedMemberId: FIXTURE_WG.memberId,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
					],
					monthCompletions: {},
				},
			}),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/chores`);
		await dismissOnboarding(page);
		const doneChore = page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' });
		await expect(doneChore).toBeVisible();
		await expect(doneChore).toBeEnabled();

		await page.evaluate(() => {
			const fixture = document.createElement('div');
			fixture.innerHTML = `
			<button data-testid="focus-button" class="outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">Button</button>
			<input data-testid="focus-input" aria-label="Fixture Eingabe" class="h-11 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
			<select data-testid="focus-select" aria-label="Fixture Auswahl" class="h-11 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"><option>Option</option></select>
			<a data-testid="focus-link" href="#focus-link-target">Link</a>
		`;
			document.body.insertBefore(fixture, document.body.firstChild);
		});

		const fixtureButton = page.getByTestId('focus-button');
		await page.emulateMedia({ forcedColors: 'none', colorScheme: 'light' });
		await page.keyboard.press('Tab');
		if (browserName === 'webkit') {
			// WebKit's default macOS Tab order skips buttons and links without Full Keyboard Access;
			// WebKit on Linux (CI) does not, so Tab lands on either the button or the input.
			await expect(
				page.locator('[data-testid="focus-button"]:focus, [data-testid="focus-input"]:focus'),
			).toHaveCount(1);
			await fixtureButton.focus();
			await expect(fixtureButton).toBeFocused();
		} else {
			await expect(fixtureButton).toBeFocused();
		}
		const lightRing = await fixtureButton.evaluate(
			(element) => getComputedStyle(element).boxShadow,
		);
		expect(lightRing).not.toBe('none');

		await page.evaluate(() => document.documentElement.classList.add('dark'));
		await page.emulateMedia({ forcedColors: 'none', colorScheme: 'dark' });
		const darkRing = await fixtureButton.evaluate((element) => getComputedStyle(element).boxShadow);
		expect(darkRing).not.toBe('none');

		await page.emulateMedia({ forcedColors: 'active' });
		await expectSystemFocusRing(page, fixtureButton);

		for (const selector of ['focus-input', 'focus-select', 'focus-link']) {
			const target = page.getByTestId(selector);
			if (browserName === 'webkit' && selector === 'focus-link') {
				await target.focus();
			} else {
				await page.keyboard.press('Tab');
			}
			await expect(target).toBeFocused();
			await expectSystemFocusRing(page, target);
			if (selector === 'focus-input' || selector === 'focus-select') {
				const height = await target.evaluate((element) => element.getBoundingClientRect().height);
				expect(height).toBeGreaterThanOrEqual(44);
			}
		}

		const choreButton = page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' });
		let reachedChoreButton = false;
		if (browserName === 'webkit') {
			// WebKit's native Tab order skips buttons and links without Full Keyboard Access.
			await choreButton.focus();
			reachedChoreButton = await choreButton.evaluate(
				(element) => element === document.activeElement,
			);
		} else {
			for (let i = 0; i < 100; i += 1) {
				await page.keyboard.press('Tab');
				if (await choreButton.evaluate((element) => element === document.activeElement)) {
					reachedChoreButton = true;
					break;
				}
			}
		}
		expect(reachedChoreButton).toBe(true);
		await expectSystemFocusRing(page, choreButton);
		const hitTarget = await choreButton.evaluate((element) => {
			const style = getComputedStyle(element, '::after');
			return { height: style.height, minWidth: style.minWidth };
		});
		expect(Number.parseFloat(hitTarget.height)).toBeGreaterThanOrEqual(44);
		expect(Number.parseFloat(hitTarget.minWidth)).toBeGreaterThanOrEqual(44);
	});
});

test.describe('label in name audit', () => {
	// Regression checks for semantics, navigation and locale: single <h1> per
	// page, WCAG 2.5.3 label-in-name on icon+text buttons, and SPA route-change
	// focus (Next's AppRouterAnnouncer never fires across sibling `/wg/[code]/*`
	// routes because `document.title` and the page's single <h1> never change).

	skipUnlessFixtures();

	const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
	// Fixture WG name (src/fixtures/data.ts E2E_EXISTING_WG.name) — not
	// exported via FIXTURE_WG, so it is duplicated here like the other specs do.
	const WG_NAME = 'Kastanienallee 12';

	const emptyDashboard = {
		balances: [],
		spendByDay: [],
		totalSpendByCurrency: {},
		weekSpendByCurrency: {},
		monthSpendByCurrency: {},
		openShoppingCount: 0,
		openShoppingTop: [],
		dueChores: [],
		dueRecurringExpenses: [],
		activity: [],
		latestAnnouncement: null,
		myOpenAnnouncements: [],
		absentMembers: [],
		setup: {
			choreCount: 0,
			hasExpense: false,
			hasShoppingItem: false,
			hasAnnouncement: false,
			notificationsEnabled: false,
		},
	};

	test('Start page has exactly one <h1>, named after the WG', async ({ page }) => {
		await setupMember(page);
		await page.route(`**${BASE}/dashboard`, (route) => route.fulfill({ json: emptyDashboard }));
		await mockUnreadCount(page, BASE);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);

		// WCAG 1.3.1 / 2.4.6 — WgAppHeader's WG-name heading must be the page's
		// only level-1 heading; the date line below it is a <h2>.
		await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
		await expect(
			page.getByRole('heading', { level: 1, name: `${WG_NAME} – Start`, exact: true }),
		).toBeVisible();
	});

	test('bottom-nav navigation moves focus to the main landmark', async ({ page }) => {
		await setupMember(page);
		await page.route(`**${BASE}/dashboard`, (route) => route.fulfill({ json: emptyDashboard }));
		await mockUnreadCount(page, BASE);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);

		const nav = page.getByRole('navigation', { name: 'WG Hauptnavigation' });
		const household = nav.getByRole('link', { name: 'Haushalt', exact: true });
		await household.click();

		// Without RouteFocusOnNavigate, the just-activated <a> keeps focus because
		// the shared <main> never remounts across sibling `/wg/[code]/*` routes.
		await expect(page.locator('#main')).toBeFocused();
	});

	test('new-WG invite card names the visible action first', async ({ page }) => {
		await setupMember(page);
		await page.route(`**${BASE}/dashboard`, (route) => route.fulfill({ json: emptyDashboard }));
		await mockUnreadCount(page, BASE);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);

		// WCAG 2.5.3 — the visible "Mitbewohner einladen" text must be the whole
		// accessible name, not a differently-worded aria-label.
		await expect(
			page.getByRole('button', { name: 'Mitbewohner einladen', exact: true }),
		).toBeVisible();
	});

	test('subscription pause button names the visible action first, then the subscription', async ({
		page,
	}) => {
		await setupMember(page);
		await page.route(`**${BASE}/members*`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
					],
				},
			}),
		);
		await page.route(`**${BASE}/recurring-expenses*`, (route) =>
			route.fulfill({
				json: {
					recurringExpenses: [
						{
							id: 'recurring-label-audit',
							description: 'Musik-Abo',
							amountCents: 999,
							currency: 'EUR',
							paidByMemberId: FIXTURE_WG.memberId,
							intervalMonths: 1,
							nextDueAt: '2026-10-01T12:00:00.000Z',
							lastCreatedAt: null,
							pausedAt: null,
							splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 999 }],
						},
					],
				},
			}),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/recurring`);
		await page.getByRole('button', { name: /Details öffnen: Musik-Abo/ }).click();

		// WCAG 2.5.3 — "Pausieren"/"Fortsetzen" must lead the accessible name,
		// disambiguated by the subscription's description.
		await expect(
			page.getByRole('button', { name: 'Pausieren: Musik-Abo', exact: true }),
		).toBeVisible();
	});

	test('expense settle button names the visible action first, then the debtor', async ({
		page,
	}) => {
		const { memberId, memberName, shareCode } = FIXTURE_WG;
		const otherMemberId = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: memberId, name: memberName, color: null, active: true },
						{ id: otherMemberId, name: 'Mina', color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({
				json: {
					expenses: [
						{
							id: 'expense-label-audit',
							paidByMemberId: memberId,
							amountCents: 2000,
							currency: 'EUR',
							description: 'Wocheneinkauf',
							imageUrl: null,
							occurredAt: '2026-09-24T17:00:00.000Z',
							createdAt: '2026-09-24T17:00:00.000Z',
							updatedAt: '2026-09-24T17:00:00.000Z',
							splits: [
								{
									id: 'split-label-audit',
									debtorMemberId: otherMemberId,
									amountCents: 1000,
									settledAt: null,
								},
							],
						},
					],
					payments: [],
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);

		await navigateToFeature(page, `/wg/${shareCode}/expenses`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: /Details öffnen/ }).click();

		// WCAG 2.5.3 — "Als bezahlt markieren"/"Wieder als offen markieren" must lead the
		// accessible name, disambiguated by the debtor's name.
		await expect(
			page.getByRole('button', { name: 'Als bezahlt markieren: Mina', exact: true }),
		).toBeVisible();
		// The debt row's settle button names the parties and amount, so several rows stay apart.
		await expect(
			page.getByRole('button', { name: /^Ausgleichen: Mina an .+, 10,00\s€$/ }),
		).toBeVisible();
	});
});

test.describe('enter key hint forms', () => {
	skipUnlessFixtures();

	// Regression: these free-text fields had no enterKeyHint, so the on-screen
	// keyboard's action key showed the generic "return" glyph instead of a
	// next/done affordance (Apple HIG / Material 3 text input guidance).
	const { shareCode, memberId, memberName } = FIXTURE_WG;

	test('inventory add name field hints "next"', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/inventory*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { items: [], grouped: {} } })
				: route.continue(),
		);

		await navigateToFeature(page, `/wg/${shareCode}/supplies`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Vorrat hinzufügen', exact: true }).first().click();

		await expect(page.locator('#inventory-name')).toHaveAttribute('enterkeyhint', 'next');
	});

	test('recurringExpense description and amount fields hint "next"', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { recurringExpenses: [] } })
				: route.continue(),
		);

		await navigateToFeature(page, `/wg/${shareCode}/recurring`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Fixkosten hinzufügen' }).click();
		await expect(page.getByRole('dialog', { name: 'Neue Fixkosten' })).toBeVisible();

		await expect(page.locator('#recurring-description')).toHaveAttribute('enterkeyhint', 'next');
		await expect(page.locator('#recurring-amount')).toHaveAttribute('enterkeyhint', 'next');
	});

	test('chore title field hints "done"', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/chores*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { chores: [] } })
				: route.continue(),
		);
		await page.route(`**/api/wg/${shareCode}/absences*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { absences: [] } })
				: route.continue(),
		);

		await navigateToFeature(page, `/wg/${shareCode}/chores`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Putzaufgabe hinzufügen', exact: true }).click();

		await expect(page.locator('#chore-title')).toHaveAttribute('enterkeyhint', 'done');
	});

	test('absence reason field hints "done"', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/chores*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { chores: [] } })
				: route.continue(),
		);
		await page.route(`**/api/wg/${shareCode}/absences*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { absences: [] } })
				: route.continue(),
		);

		await navigateToFeature(page, `/wg/${shareCode}/chores?panel=absences`);
		await dismissOnboarding(page);
		// `?panel=absences` already opens the form (button reads "...schließen").

		await expect(page.locator('#absence-reason')).toHaveAttribute('enterkeyhint', 'done');
	});

	test('absence form opened by ?panel=absences can be closed', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/chores*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { chores: [] } })
				: route.continue(),
		);
		await page.route(`**/api/wg/${shareCode}/absences*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { absences: [] } })
				: route.continue(),
		);

		await navigateToFeature(page, `/wg/${shareCode}/chores?panel=absences`);
		await dismissOnboarding(page);
		const toggle = page.locator('button[aria-controls="absence-form"]');
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');

		await toggle.click();

		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		// Stays closed instead of being reopened by the cleared fields.
		await page.waitForTimeout(500);
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	});

	test('expense description and amount fields hint "next"', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
			route.fulfill({
				json: { members: [{ id: memberId, name: memberName, color: null, active: true }] },
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { expenses: [], payments: [] } })
				: route.continue(),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { recurringExpenses: [] } })
				: route.continue(),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard*`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);

		await navigateToFeature(page, `/wg/${shareCode}/expenses`);
		await dismissOnboarding(page);
		// The bottom button opens the form.
		await page
			.locator('[data-page-primary-action]')
			.getByRole('button', { name: 'Ausgabe hinzufügen' })
			.click();

		await expect(page.locator('#expense-description')).toHaveAttribute('enterkeyhint', 'next');
		await expect(page.locator('#f-betrag')).toHaveAttribute('enterkeyhint', 'next');
	});
});

test.describe('enter key next field', () => {
	skipUnlessFixtures();

	// Regression: a field whose keyboard key reads "next" submitted the whole form
	// and flagged the still-empty fields below it.
	test('the "next" key moves to the following field instead of submitting', async ({ page }) => {
		await mockNoWgs(page);
		let submitted = false;
		await page.route('**/api/wg', (route) => {
			if (route.request().method() === 'POST') submitted = true;
			return route.fulfill({ status: 500, json: { error: 'unexpected' } });
		});

		await page.goto('/login');
		await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
		const wgName = page.getByLabel('WG-Name');
		await expect(wgName).toHaveAttribute('enterkeyhint', 'next');
		await wgName.fill('Sonnenallee');
		await wgName.press('Enter');

		await expect(page.getByLabel('Dein Anzeigename')).toBeFocused();
		await expect(page.locator('#create-wg-error, #create-wg-form-error')).toHaveCount(0);
		expect(submitted).toBe(false);
	});
});
