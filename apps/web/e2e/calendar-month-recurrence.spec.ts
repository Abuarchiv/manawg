// Calendar month grid, recurrence editing, deletion and push links in the browser.
// Why: A calendar day must be identical for every device time zone.

import { expect, type Route, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('calendar month grid and recurrence', () => {
	test('shows a fetched multi-day event on every overlapping month-grid day', async ({ page }) => {
		skipUnlessFixtures();

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

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
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
		skipUnlessFixtures();

		await page.setViewportSize({ width: 320, height: 812 });
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
			route.fulfill({ json: { events: [] } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
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

		await page.route('**/__e2e-font-scale-200.css', (route) =>
			route.fulfill({ contentType: 'text/css', body: ':root { font-size: 32px !important; }' }),
		);
		await page.addStyleTag({
			url: new URL('/__e2e-font-scale-200.css', page.url()).toString(),
		});
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
		skipUnlessFixtures();

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

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'WG-Meeting' }).first().click();

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
		skipUnlessFixtures();
		const event = {
			id: '33333333-3333-4333-8333-333333333333',
			title: 'Termin mit laufender Aktualisierung',
			description: null,
			startsAt: new Date(Date.now() + 86_400_000).toISOString(),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			// Own event, so the UI offers delete.
			createdByMemberId: FIXTURE_WG.memberId,
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
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
		await dismissOnboarding(page);
		const eventButton = page.getByRole('button', {
			name: event.title,
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
		skipUnlessFixtures();
		const event = {
			id: '44444444-4444-4444-8444-444444444444',
			title: 'Termin aus Push-Link',
			description: null,
			startsAt: new Date(Date.now() + 86_400_000).toISOString(),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			// Own event, so the UI offers delete; the 403 simulates a server-side role change.
			createdByMemberId: FIXTURE_WG.memberId,
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
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar?highlight=${event.id}`);
		await dismissOnboarding(page);
		await expect(page.locator(`#event-${event.id}`)).toBeVisible();
		await page.getByRole('button', { name: event.title }).click();
		await page.getByRole('button', { name: 'Termin löschen', exact: true }).click();
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: 'Löschen', exact: true })
			.click();
		await expect(
			page.getByRole('alert').filter({ hasText: 'Das dürfen nur WG-Admins' }).first(),
		).toBeVisible();
	});

	test('push link to an event beyond the agenda window opens that event', async ({ page }) => {
		skipUnlessFixtures();
		const startsAt = new Date(Date.now() + 120 * 86_400_000).toISOString();
		const event = {
			id: '55555555-5555-4555-8555-555555555555',
			title: 'Fernes Sommerfest',
			description: null,
			startsAt,
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			wgId: FIXTURE_WG.id,
			createdByMemberId: FIXTURE_WG.memberId,
			createdAt: startsAt,
			updatedAt: startsAt,
		};
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
			route.fulfill({ json: { events: [] } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events/${event.id}`, (route) =>
			route.fulfill({ json: { event } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar?highlight=${event.id}`);
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Termin bearbeiten' })).toBeVisible();
		await expect(page.locator(`input[value="${event.title}"]`)).toBeVisible();
	});

	test('keeps complex recurrence on title-only save and replaces it explicitly', async ({
		page,
	}) => {
		skipUnlessFixtures();
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

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
		await dismissOnboarding(page);
		const openEdit = (title: string) => page.getByRole('button', { name: title }).first();
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

	test('members who did not create an event get a read-only view', async ({ page }) => {
		skipUnlessFixtures();
		const event = {
			id: '55555555-5555-4555-8555-555555555555',
			title: 'Fremder Termin',
			description: null,
			startsAt: new Date(Date.now() + 86_400_000).toISOString(),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			createdByMemberId: '99999999-9999-4999-8999-999999999999',
		};
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
			route.fulfill({ json: { events: [event] } }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: event.title }).click();
		await expect(page.getByRole('heading', { name: 'Termin', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Termin löschen', exact: true })).toHaveCount(0);
	});
});
