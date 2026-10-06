// Calendar: all-day/timed events across Berlin DST and extreme time zones, recurrence, ICS, month grid, public preview.
// Why: a calendar day must be identical for every device time zone.

import { type Route, expect, test } from '@playwright/test';
import type { EventInput } from '../src/features/events/events';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';
import { applyRootTextScale, resetRootTextScale } from './support/text-scale';

test.describe('calendar fixes', () => {
	test('shows a fetched multi-day event on every overlapping month-grid day', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);

		const now = new Date();
		const year = Number(
			new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', year: 'numeric' }).format(now),
		);
		const month = Number(
			new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', month: 'numeric' }).format(now),
		);
		const startsAt = new Date(Date.UTC(year, month - 1, 2)).toISOString();
		const endsAt = new Date(Date.UTC(year, month - 1, 4)).toISOString();
		const selectedDayLabel = new Intl.DateTimeFormat('de-DE', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'Europe/Berlin',
		}).format(new Date(Date.UTC(year, month - 1, 3)));
		const event = {
			id: '33333333-3333-4333-8333-333333333333',
			title: 'Mehrtagestermin',
			description: null,
			startsAt,
			endsAt,
			allDay: true,
			location: null,
			recurrence: null,
			wgId: FIXTURE_WG.id,
			createdByMemberId: FIXTURE_WG.memberId,
			createdAt: startsAt,
			updatedAt: startsAt,
		};

		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
			route.fulfill({ json: { events: [event] } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		await dismissOnboarding(page);
		await page.getByRole('tab', { name: 'Monat' }).click();
		const occupiedDays = page.locator('[data-day-cell][aria-label$=", 1 Termin"]');
		await expect(occupiedDays).toHaveCount(3);
		await page.getByRole('button', { name: selectedDayLabel }).click();
		await expect(
			page
				.getByRole('region', { name: 'Termine am ausgewählten Tag' })
				.getByText('Mehrtagestermin'),
		).toBeVisible();
	});

	test('keeps the month grid accessible and keyboard focus after paging at 320px', async ({
		page,
	}) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);

		await page.setViewportSize({ width: 320, height: 812 });
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
			route.fulfill({ json: { events: [] } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		await dismissOnboarding(page);
		await page.getByRole('tab', { name: 'Monat' }).click();

		const grid = page.getByRole('grid');
		const rows = grid.getByRole('row');
		await expect(rows.first().getByRole('columnheader')).toHaveCount(7);
		await expect(rows.nth(1).getByRole('gridcell')).toHaveCount(7);
		const gridCells = grid.getByRole('gridcell');
		const cellCount = await gridCells.count();
		expect(cellCount).toBeGreaterThanOrEqual(28);
		expect(cellCount).toBeLessThanOrEqual(42);
		expect(cellCount % 7).toBe(0);
		await expect(grid.locator('[role="gridcell"][aria-selected]')).toHaveCount(cellCount);

		const dayButtons = page.locator('[data-day-cell]');
		const assertPhoneLayout = async (colorScheme: 'light' | 'dark', fontSize: number) => {
			await expect
				.poll(() => page.locator('html').evaluate((html) => html.classList.contains('dark')))
				.toBe(colorScheme === 'dark');
			const pageState = await page.evaluate(() => ({
				viewport: document.documentElement.clientWidth,
				scroll: document.documentElement.scrollWidth,
				fontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
				prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
				darkClass: document.documentElement.classList.contains('dark'),
			}));
			expect(pageState.scroll).toBeLessThanOrEqual(pageState.viewport);
			expect(pageState.fontSize).toBe(fontSize);
			expect(pageState.prefersDark).toBe(colorScheme === 'dark');
			expect(pageState.darkClass).toBe(colorScheme === 'dark');
			const widths = await dayButtons.evaluateAll((buttons) =>
				buttons.map((button) => button.getBoundingClientRect().width),
			);
			expect(Math.min(...widths)).toBeGreaterThanOrEqual(44);
			const tabsFit = await page
				.getByRole('tab')
				.evaluateAll((tabs) => tabs.every((tab) => tab.scrollWidth <= tab.clientWidth));
			expect(tabsFit).toBe(true);
		};
		const baseFontSize = await page.evaluate(() =>
			Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
		);

		const firstMonth = await grid.getAttribute('aria-label');
		await page.locator('[data-day-cell][tabindex="0"]').press('PageDown');
		await expect.poll(() => grid.getAttribute('aria-label')).not.toBe(firstMonth);
		const focusedDay = page.locator('[data-day-cell]:focus');
		await expect(focusedDay).toHaveCount(1);
		await expect(focusedDay).toHaveAttribute('tabindex', '0');
		const focusedLabel = await focusedDay.getAttribute('aria-label');
		await focusedDay.press('ArrowRight');
		await expect
			.poll(() => page.locator('[data-day-cell]:focus').getAttribute('aria-label'))
			.not.toBe(focusedLabel);
		await expect(page.locator('[data-day-cell]:focus')).toHaveAttribute('tabindex', '0');

		for (const width of [320, 360]) {
			await page.setViewportSize({ width, height: 812 });
			for (const colorScheme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme });
				await assertPhoneLayout(colorScheme, baseFontSize);
			}
		}

		await applyRootTextScale(page, 200);
		for (const width of [320, 360]) {
			await page.setViewportSize({ width, height: 812 });
			for (const colorScheme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme });
				await assertPhoneLayout(colorScheme, 32);
			}
		}
		await expect(page.getByRole('tab', { name: 'Agenda' })).toBeVisible();
		await expect(page.getByRole('tab', { name: 'Monat' })).toBeVisible();
	});

	test('edit recurrence uses the canonical select and sends an RFC rule', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);

		const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
		const event = {
			id: '11111111-1111-4111-8111-111111111111',
			title: 'WG-Meeting',
			description: null,
			startsAt,
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: 'FREQ=WEEKLY',
			wgId: FIXTURE_WG.id,
			createdByMemberId: FIXTURE_WG.memberId,
			createdAt: startsAt,
			updatedAt: startsAt,
		};
		let patchBody: Record<string, unknown> | null = null;
		let patchMethod: string | null = null;
		const handleEventsRoute = async (route: Route): Promise<void> => {
			patchMethod = route.request().method();
			if (patchMethod === 'PATCH') {
				patchBody = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({ json: { event: { ...event, ...patchBody } } });
				return;
			}
			await route.fulfill({ json: { events: [event] } });
		};

		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, handleEventsRoute);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events/**`, handleEventsRoute);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		await dismissOnboarding(page);
		await page
			.getByRole('button', { name: 'Termin bearbeiten: WG-Meeting', exact: true })
			.first()
			.click();

		const recurrence = page.locator('#event-edit-recurrence');
		await expect(recurrence).toHaveValue('WEEKLY');
		await recurrence.selectOption('DAILY');
		await page.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect.poll(() => patchMethod).toBe('PATCH');
		await expect
			.poll(() => patchBody)
			.toEqual(expect.objectContaining({ recurrence: 'FREQ=DAILY' }));
	});

	test('successful deletion removes an event restored by a concurrent refresh', async ({
		page,
	}) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const event: EventInput = {
			id: '33333333-3333-4333-8333-333333333333',
			title: 'Termin mit laufender Aktualisierung',
			description: null,
			startsAt: new Date(Date.now() + 86_400_000).toISOString(),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
		};
		let markDeleteStarted: () => void = () => {};
		let releaseDelete: () => void = () => {};
		const deleteStarted = new Promise<void>((resolve) => {
			markDeleteStarted = resolve;
		});
		const deleteGate = new Promise<void>((resolve) => {
			releaseDelete = resolve;
		});
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
			route.fulfill({ json: { events: [event] } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events/${event.id}`, async (route) => {
			markDeleteStarted();
			await deleteGate;
			await route.fulfill({ json: { deleted: true } });
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		await dismissOnboarding(page);
		const eventButton = page.getByRole('button', {
			name: `Termin bearbeiten: ${event.title}`,
			exact: true,
			includeHidden: true,
		});
		await eventButton.click();
		await page.getByRole('button', { name: 'Termin löschen', exact: true }).click();
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: 'Löschen', exact: true })
			.click();
		await deleteStarted;
		try {
			await expect(eventButton).toHaveCount(0);
			await page.evaluate(() => window.dispatchEvent(new Event('focus')));
			await expect(eventButton).toHaveCount(1);
		} finally {
			releaseDelete();
		}
		await expect(page.getByRole('heading', { name: 'Termin bearbeiten', exact: true })).toHaveCount(
			0,
		);
		await expect(eventButton).toHaveCount(0);
		await expect(page.getByText('Termin gelöscht.')).toBeVisible();
	});

	test('push link highlights its event and a 403 names who may change it', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const event: EventInput = {
			id: '44444444-4444-4444-8444-444444444444',
			title: 'Termin aus Push-Link',
			description: null,
			startsAt: new Date(Date.now() + 86_400_000).toISOString(),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
		};
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
			route.fulfill({ json: { events: [event] } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events/${event.id}`, (route) =>
			route.fulfill({ status: 403, json: { error: 'not_owner' } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender?highlight=${event.id}`);
		await dismissOnboarding(page);
		await expect(page.locator(`#event-${event.id}`)).toBeVisible();
		await page
			.getByRole('button', { name: `Termin bearbeiten: ${event.title}`, exact: true })
			.click();
		await page.getByRole('button', { name: 'Termin löschen', exact: true }).click();
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: 'Löschen', exact: true })
			.click();
		await expect(
			page.getByRole('alert').filter({ hasText: 'Das dürfen nur WG-Admins' }).first(),
		).toBeVisible();
	});

	test('keeps complex recurrence on title-only save and replaces it explicitly', async ({
		page,
	}) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await page.setViewportSize({ width: 320, height: 740 });
		await page.addInitScript(() => localStorage.setItem('manawg-theme', 'light'));

		const complexRule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=4';
		const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
		let event = {
			id: '22222222-2222-4222-8222-222222222222',
			title: 'WG-Meeting',
			description: null,
			startsAt,
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: complexRule,
			wgId: FIXTURE_WG.id,
			createdByMemberId: FIXTURE_WG.memberId,
			createdAt: startsAt,
			updatedAt: startsAt,
		};
		const patches: Array<Record<string, unknown>> = [];
		const handleEventsRoute = async (route: Route): Promise<void> => {
			if (route.request().method() === 'PATCH') {
				const patch = route.request().postDataJSON() as Record<string, unknown>;
				patches.push(patch);
				event = { ...event, ...patch };
				await route.fulfill({ json: { event } });
				return;
			}
			await route.fulfill({ json: { events: [event] } });
		};

		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, handleEventsRoute);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events/**`, handleEventsRoute);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		await dismissOnboarding(page);
		const openEdit = (title: string) =>
			page.getByRole('button', { name: `Termin bearbeiten: ${title}`, exact: true }).first();
		await openEdit('WG-Meeting').click();

		const recurrence = page.locator('#event-edit-recurrence');
		await expect(recurrence).toHaveValue('__keep__');
		await recurrence.scrollIntoViewIfNeeded();
		await page.screenshot({ path: test.info().outputPath('calendar-edit-light.png') });
		await page.evaluate(() => {
			localStorage.setItem('manawg-theme', 'dark');
		});
		await page.addInitScript(() => localStorage.setItem('manawg-theme', 'dark'));
		await page.reload({ waitUntil: 'domcontentloaded' });
		await dismissOnboarding(page);
		await openEdit('WG-Meeting').click();
		await expect(page.locator('html')).toHaveClass(/dark/);
		await expect(recurrence).toHaveValue('__keep__');
		await recurrence.scrollIntoViewIfNeeded();
		await page.screenshot({ path: test.info().outputPath('calendar-edit-dark.png') });
		await page.locator('#event-edit-title').fill('WG-Meeting umbenannt');
		await page.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect.poll(() => patches).toHaveLength(1);
		expect(patches[0]?.recurrence).toBe(complexRule);

		await openEdit('WG-Meeting umbenannt').click();
		await recurrence.selectOption('WEEKLY');
		await page.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect.poll(() => patches).toHaveLength(2);
		expect(patches[1]?.recurrence).toBe('FREQ=WEEKLY');
	});
});

test.describe('calendar date and recurrence regressions', () => {
	test('calendar creation retains its complete draft and a cleared start across close/reopen', async ({
		page,
	}) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) => {
			if (route.request().method() === 'POST') {
				return route.fulfill({
					json: {
						event: {
							...route.request().postDataJSON(),
							id: 'created-event',
							wgId: FIXTURE_WG.id,
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
						},
					},
				});
			}
			return route.fulfill({ json: { events: [] } });
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		const open = page.getByRole('button', { name: 'Termin hinzufügen', exact: true }).first();
		await open.click();
		await page.locator('#event-create-title').fill('Entwurf bleibt');
		await page.locator('#event-create-start').fill('2026-09-25T18:00');
		await page.locator('#event-create-end').fill('2026-09-25T20:00');
		await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
		await open.click();
		await expect(page.locator('#event-create-title')).toHaveValue('Entwurf bleibt');
		await expect(page.locator('#event-create-start')).toHaveValue('2026-09-25T18:00');
		await expect(page.locator('#event-create-end')).toHaveValue('2026-09-25T20:00');
		await page.locator('#event-create-start').fill('');
		await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
		await open.click();
		await expect(page.locator('#event-create-start')).toHaveValue('');
		await expect(page.locator('#event-create-end')).toHaveValue('2026-09-25T20:00');
		await page.locator('#event-create-start').fill('2026-09-25T18:00');
		await page.getByRole('button', { name: 'Termin speichern', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Neuer Termin', exact: true })).toBeHidden();
		await open.click();
		await expect(page.locator('#event-create-title')).toHaveValue('');
		await expect(page.locator('#event-create-end')).toHaveValue('');
		await expect(page.locator('#event-create-start')).not.toHaveValue('');
	});

	test('browser back closes the open create sheet, keeps the page and the draft', async ({
		page,
	}) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
			route.fulfill({ json: { events: [] } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		const url = page.url();
		const open = page.getByRole('button', { name: 'Termin hinzufügen', exact: true }).first();
		await open.click();
		await page.locator('#event-create-title').fill('Zurück behält Entwurf');
		await page.goBack();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(page.url()).toBe(url);
		await open.click();
		await expect(page.locator('#event-create-title')).toHaveValue('Zurück behält Entwurf');
		// Closing through the UI removes the marker entry: back now leaves the page.
		await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect
			.poll(() => page.evaluate(() => window.history.state?.overlayId ?? null))
			.toBeNull();
		await page.goBack();
		await expect(page).not.toHaveURL(url);
	});

	test('theme changes received from another tab update the document class', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('manawg-theme', 'light'));
		await page.goto('/');
		await expect
			.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
			.toBe(false);
		await page.evaluate(() => {
			window.dispatchEvent(
				new StorageEvent('storage', {
					key: 'manawg-theme',
					newValue: 'dark',
					storageArea: window.localStorage,
				}),
			);
		});
		await expect
			.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
			.toBe(true);
	});
});

test.describe('public calendar preview responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('keeps the featured calendar preview readable at narrow widths and 200% text', async ({
		page,
	}) => {
		await page.goto('/entdecken/kalender');

		const example = page.locator('article[aria-label="Kalender, Beispiel-WG"]');
		await expect(example).toBeVisible();

		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });

			for (const textScale of ['normal', '200%'] as const) {
				if (textScale === '200%') await applyRootTextScale(page, 200);
				else await resetRootTextScale(page);

				for (const width of [320, 360, 390]) {
					await page.setViewportSize({ width, height: 812 });

					const metrics = await example.locator('[data-slot="item"]').evaluate((row) => {
						const content = row.querySelector<HTMLElement>('[data-slot="item-content"]');
						if (!content) throw new Error('Preview row has no text content');

						return {
							contentWidth: content.getBoundingClientRect().width,
							rowWidth: row.getBoundingClientRect().width,
							rowHeight: row.getBoundingClientRect().height,
							rootFontSize: getComputedStyle(document.documentElement).fontSize,
						};
					});

					if (textScale === '200%') expect(metrics.rootFontSize).toBe('32px');
					expect(
						metrics.contentWidth,
						`${width}px ${colorScheme} ${textScale}: preview text must not collapse between the icon and badge`,
					).toBeGreaterThanOrEqual(metrics.rowWidth * 0.45);
					expect(metrics.rowHeight).toBeLessThan(480);
				}
			}
		}

		const homeLink = page
			.getByRole('navigation', { name: 'Öffentliche Hauptnavigation' })
			.getByRole('link', { name: 'Start', exact: true });
		await expect(homeLink).toHaveAttribute('href', '/');
		await homeLink.focus();
		await expect(homeLink).toBeFocused();
	});
});

test.describe('marker mobile overflow', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	for (const width of [320, 360] as const) {
		for (const colorScheme of ['light', 'dark'] as const) {
			if (width !== 320) continue;
			test(`chat date separator fits a ${width}px viewport at 200% text (${colorScheme})`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height: 844 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/chat`);
				await dismissOnboarding(page);
				await applyRootTextScale(page, 200);

				await expect(page.getByRole('textbox', { name: 'Chat-Nachricht' })).toBeVisible();
				const isDark = await page
					.locator('html')
					.evaluate((element) => element.classList.contains('dark'));
				expect(isDark).toBe(colorScheme === 'dark');
				const rootFontSize = await page.evaluate(() =>
					Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
				);
				expect(rootFontSize).toBeGreaterThanOrEqual(30);
				const marker = page.locator('[data-slot="marker-content"]').first();
				await expect(marker).toBeVisible();
				await expect(marker).toHaveText(/\d{1,2}\./);
				await marker.evaluate((element) => {
					element.textContent = 'Donnerstag, 30. September';
				});
				await expect(marker).toHaveText('Donnerstag, 30. September');
				const bounds = await marker.boundingBox();

				if (!bounds) throw new Error('chat date marker has no visible bounds');
				expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);

				const nav = page.getByRole('navigation', { name: 'WG Hauptnavigation' });
				await expect(nav).toBeVisible();
				const navTargets = await nav.locator('a[data-bottom-nav-item]').evaluateAll((items) =>
					items.map((item) => {
						const { x, y, width, height, right, bottom } = item.getBoundingClientRect();
						return { x, y, width, height, right, bottom };
					}),
				);
				expect(navTargets).toHaveLength(4);
				for (const target of navTargets) {
					expect(target.x).toBeGreaterThanOrEqual(0);
					expect(target.right).toBeLessThanOrEqual(width);
					expect(target.y + target.height).toBeLessThanOrEqual(844);
					expect(target.width).toBeGreaterThanOrEqual(44);
					expect(target.height).toBeGreaterThanOrEqual(44);
				}

				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
				await dismissOnboarding(page);
				await applyRootTextScale(page, 200);
				const header = page.locator('[data-home-header]');
				await expect(header).toBeVisible();
				await expect(
					header.getByRole('link', { name: 'Konto und WG-Einstellungen öffnen' }),
				).toBeVisible();
				const headerBounds = await header.boundingBox();
				const actionBounds = await header.locator('a').evaluateAll((links) =>
					links.map((link) => {
						const { x, right } = link.getBoundingClientRect();
						return { x, right };
					}),
				);
				if (!headerBounds) throw new Error('WG home header has no visible bounds');
				expect(headerBounds.x + headerBounds.width).toBeLessThanOrEqual(width);
				for (const action of actionBounds) {
					expect(action.x).toBeGreaterThanOrEqual(0);
					expect(action.right).toBeLessThanOrEqual(width);
				}
			});
		}
	}
});
