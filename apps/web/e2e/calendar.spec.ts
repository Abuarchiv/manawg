// Calendar: all-day/timed events across Berlin DST and extreme time zones, recurrence, ICS, month grid, public preview.
// Why: a calendar day must be identical for every device time zone.

import { type Page, type Route, expect, test } from '@playwright/test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { inputDateToIso } from '../src/core/utils/local-date';
import { detectMention } from '../src/features/chat/chat-pure';
import { computeTomorrowUtcWindow } from '../src/features/events/event-reminder-window';
import {
	type EventInput,
	eventDateForDisplay,
	expandAgendaRecurrence,
	expandRecurrence,
	formatEventTimeRange,
	getCalendarDayBounds,
	getMonthBounds,
	normalizeEventDateTime,
	validateEventForm,
} from '../src/features/events/events';
import { occurrenceToIcs } from '../src/features/events/ics';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.describe('calendar fixes', () => {
	const ALL_DAY_EVENT: EventInput = {
		id: 'all-day-pilot',
		title: 'Pilottag',
		description: null,
		startsAt: '2026-09-29T00:00:00.000Z',
		endsAt: null,
		allDay: true,
		location: null,
		recurrence: null,
	};

	function expandAgenda(event: EventInput, from: string | Date, to: string | Date) {
		return expandAgendaRecurrence(event, new Date(from), new Date(to));
	}

	test('keeps inclusive multi-day all-day overlap across the Berlin fall DST date', () => {
		const occurrences = expandAgenda(
			{
				...ALL_DAY_EVENT,
				id: 'multi-day-pilot',
				startsAt: '2026-10-24T00:00:00.000Z',
				endsAt: '2026-10-25T00:00:00.000Z',
				recurrence: null,
			},
			'2026-10-25T18:00:00.000Z',
			'2026-10-25T22:00:00.000Z',
		);

		expect(occurrences).toHaveLength(1);
		expect(occurrences[0]).toMatchObject({
			startsAt: '2026-10-24T00:00:00.000Z',
			endsAt: '2026-10-25T00:00:00.000Z',
		});
	});

	test('matches event display dates and query windows using inclusive overlap', async () => {
		const eventHelpers = (await import('../src/features/events/events')) as unknown as {
			eventOverlapsCalendarDay?: (
				event: { startsAt: string; endsAt: string | null; allDay: boolean },
				day: Date,
			) => boolean;
		};
		const windowHelpers = (await import(
			'../src/features/events/event-reminder-window'
		)) as unknown as {
			buildEventsWindowFilter?: (from: Date, to: Date) => SQL | undefined;
		};
		const eventOverlapsCalendarDay = eventHelpers.eventOverlapsCalendarDay;
		const buildEventsWindowFilter = windowHelpers.buildEventsWindowFilter;
		expect(eventOverlapsCalendarDay).toBeDefined();
		expect(buildEventsWindowFilter).toBeDefined();
		if (!eventOverlapsCalendarDay || !buildEventsWindowFilter) return;

		const event = {
			startsAt: '2026-09-22T00:00:00.000Z',
			endsAt: '2026-09-24T00:00:00.000Z',
			allDay: true,
		};
		expect(
			[22, 23, 24, 25].map((day) => eventOverlapsCalendarDay(event, new Date(2026, 8, day))),
		).toEqual([true, true, true, false]);

		const from = new Date('2026-09-23T12:00:00.000Z');
		const to = new Date('2026-09-26T00:00:00.000Z');
		const filter = buildEventsWindowFilter(from, to);
		expect(filter).toBeDefined();
		if (!filter) return;
		const query = new PgDialect().sqlToQuery(filter);
		const startsAtUpperBound = query.sql.match(/starts_at"\s*<=\s*\$(\d+)/);
		expect(startsAtUpperBound).not.toBeNull();
		expect(query.params[Number(startsAtUpperBound?.[1]) - 1]).toBe(to.toISOString());
		const allDayBoundary = query.sql.match(
			/"wg_events"\."all_day"\s*=\s*\$(\d+)\s+and\s+"wg_events"\."ends_at"\s*>=\s*\$(\d+)/,
		);
		expect(allDayBoundary).not.toBeNull();
		expect(query.params[Number(allDayBoundary?.[1]) - 1]).toBe(true);
		expect(query.params[Number(allDayBoundary?.[2]) - 1]).toBe(from.toISOString());
		const timedBoundary = query.sql.match(
			/"wg_events"\."all_day"\s*=\s*\$(\d+)\s+and\s+"wg_events"\."ends_at"\s*>\s*\$(\d+)/,
		);
		expect(timedBoundary).not.toBeNull();
		expect(query.params[Number(timedBoundary?.[1]) - 1]).toBe(false);
		expect(query.params[Number(timedBoundary?.[2]) - 1]).toBe(from.toISOString());
	});

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

	test('uses Berlin calendar boundaries for all-day overlap and recurrence search', () => {
		const previousTimezone = process.env.TZ;
		process.env.TZ = 'Europe/Berlin';
		try {
			expect(
				expandAgenda(ALL_DAY_EVENT, '2026-09-28T22:01:00.000Z', '2026-09-28T23:00:00.000Z'),
			).toHaveLength(1);
			expect(
				expandAgenda(ALL_DAY_EVENT, '2026-09-29T22:30:00.000Z', '2026-09-29T23:00:00.000Z'),
			).toHaveLength(0);

			const fallDstEvent = { ...ALL_DAY_EVENT, startsAt: '2026-10-25T00:00:00.000Z' };
			expect(
				expandAgenda(fallDstEvent, '2026-10-24T22:30:00.000Z', '2026-10-24T23:00:00.000Z'),
			).toHaveLength(1);
			expect(
				expandAgenda(fallDstEvent, '2026-10-25T23:30:00.000Z', '2026-10-26T00:00:00.000Z'),
			).toHaveLength(0);

			const daily = {
				...ALL_DAY_EVENT,
				recurrence: 'FREQ=DAILY;COUNT=2',
			};
			expect(
				expandAgenda(daily, '2026-09-29T22:30:00.000Z', '2026-09-29T23:00:00.000Z').map(
					(occurrence) => occurrence.startsAt,
				),
			).toEqual(['2026-09-30T00:00:00.000Z']);
		} finally {
			if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
			else process.env.TZ = previousTimezone;
		}
	});

	test('uses the runtime local calendar date before a UTC+14 event marker', () => {
		const previousTimezone = process.env.TZ;
		process.env.TZ = 'Pacific/Kiritimati';
		try {
			expect(
				expandAgenda(
					{ ...ALL_DAY_EVENT, startsAt: '2026-01-01T00:00:00.000Z' },
					'2025-12-31T10:30:00.000Z',
					'2025-12-31T11:00:00.000Z',
				),
			).toHaveLength(1);
			expect(
				expandAgenda(
					{ ...ALL_DAY_EVENT, startsAt: '2026-01-01T00:00:00.000Z' },
					'2026-01-01T10:30:00.000Z',
					'2026-01-01T11:00:00.000Z',
				),
			).toHaveLength(0);
		} finally {
			if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
			else process.env.TZ = previousTimezone;
		}
	});

	test('cron Berlin window excludes a finished all-day event on a UTC host', () => {
		const window = computeTomorrowUtcWindow(new Date('2026-09-29T09:00:00.000Z'));
		expect(window.start.toISOString()).toBe('2026-09-29T22:00:00.000Z');
		expect(expandRecurrence(ALL_DAY_EVENT, window.start, window.end)).toHaveLength(0);
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

test.describe('date compatibility', () => {
	function event(startsAt: string, endsAt: string | null = null): EventInput {
		return {
			id: 'date-regression',
			title: 'Geburtstag',
			description: null,
			startsAt,
			endsAt,
			allDay: true,
			location: null,
			recurrence: null,
		};
	}

	function inputDate(iso: string): string {
		const display = eventDateForDisplay(iso, true);
		const pad = (value: number) => String(value).padStart(2, '0');
		return `${display.getFullYear()}-${pad(display.getMonth() + 1)}-${pad(display.getDate())}T00:00`;
	}

	for (const timezone of ['UTC', 'Europe/Berlin', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
		test(`legacy all-day display and title-only edits preserve timestamps in ${timezone}`, () => {
			const previousTimezone = process.env.TZ;
			process.env.TZ = timezone;
			try {
				// The old form stored device-local midnight or the retained time after toggling all-day.
				for (const time of ['00:00', '14:37']) {
					const legacy = event(
						new Date(`2026-09-22T${time}`).toISOString(),
						new Date('2026-09-23T15:41').toISOString(),
					);
					expect(inputDate(legacy.startsAt)).toBe('2026-09-22T00:00');
					const [occurrence] = expandRecurrence(legacy, '2026-09-01', '2026-10-01');
					if (!occurrence) throw new Error('expected legacy occurrence');
					expect(formatEventTimeRange(occurrence)).toContain('22.09.2026 · ganztägig');
					const edited = validateEventForm({
						title: 'Nur Titel geändert',
						startsAt: inputDate(legacy.startsAt),
						endsAt: inputDate(legacy.endsAt as string),
						allDay: true,
						original: legacy,
					});
					if (!edited.ok) throw new Error(edited.error);
					expect(edited.startsAt.toISOString()).toBe(legacy.startsAt);
					expect(edited.endsAt?.toISOString()).toBe(legacy.endsAt);
					const changed = validateEventForm({
						title: legacy.title,
						startsAt: '2026-09-23T00:00',
						endsAt: '2026-09-23T00:00',
						allDay: true,
						original: legacy,
					});
					if (!changed.ok) throw new Error(changed.error);
					expect(changed.startsAt.toISOString()).toBe('2026-09-23T00:00:00.000Z');
					expect(changed.endsAt?.toISOString()).toBe('2026-09-23T00:00:00.000Z');
				}
				// No format/version marker exists: exact UTC midnight always means the UTC date,
				// including indistinguishable legacy midnight values. Never infer the original zone.
				expect(inputDate('2026-09-22T00:00:00.000Z')).toBe('2026-09-22T00:00');
			} finally {
				if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
				else process.env.TZ = previousTimezone;
			}
		});

		test(`all-day agenda covers the entire local calendar day in ${timezone}`, () => {
			const previousTimezone = process.env.TZ;
			process.env.TZ = timezone;
			try {
				for (const day of ['2026-09-22', '2026-03-29', '2026-10-25', '2026-03-08', '2026-11-01']) {
					for (const startsAt of [`${day}T00:00:00.000Z`, new Date(`${day}T14:37`).toISOString()]) {
						for (const endsAt of [null, startsAt]) {
							for (const recurrence of [null, 'FREQ=DAILY;COUNT=1']) {
								const stored = { ...event(startsAt, endsAt), recurrence };
								const first = new Date(`${day}T00:00`);
								const last = new Date(`${day}T23:59:59.999`);
								for (const now of [first, new Date(`${day}T12:00`), last]) {
									const occurrences = expandAgendaRecurrence(stored, now, last);
									expect(occurrences).toHaveLength(1);
									expect(occurrences[0]?.startsAt).toBe(startsAt);
								}
								const tomorrow = new Date(last.getTime() + 1);
								expect(
									expandAgendaRecurrence(stored, tomorrow, new Date(tomorrow.getTime() + 1)),
								).toEqual([]);
								expect(
									expandAgendaRecurrence(
										stored,
										new Date(first.getTime() - 1),
										new Date(first.getTime() - 1),
									),
								).toEqual([]);
								const queryBounds = getCalendarDayBounds(first);
								expect(queryBounds.start.getTime()).toBeLessThanOrEqual(Date.parse(startsAt));
								expect(queryBounds.end.getTime()).toBeGreaterThanOrEqual(Date.parse(startsAt));
							}
						}
					}
					const timed = { ...event(new Date(`${day}T08:00`).toISOString()), allDay: false };
					expect(
						expandAgendaRecurrence(timed, new Date(`${day}T12:00`), new Date(`${day}T23:59`)),
					).toEqual([]);
					const equalEnd = event(`${day}T00:00:00.000Z`, `${day}T00:00:00.000Z`);
					const [occurrence] = expandAgendaRecurrence(
						equalEnd,
						new Date(`${day}T12:00`),
						new Date(`${day}T23:59`),
					);
					if (!occurrence) throw new Error('expected same-day occurrence');
					expect(occurrence.endsAt).toBe(equalEnd.endsAt);
					const next = new Date(`${day}T00:00Z`);
					next.setUTCDate(next.getUTCDate() + 1);
					expect(occurrenceToIcs(occurrence)).toContain(
						`DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replaceAll('-', '')}\r\n`,
					);
				}
			} finally {
				if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
				else process.env.TZ = previousTimezone;
			}
		});
	}
});

test.describe('calendar date and recurrence regressions', () => {
	test('date inputs round-trip the same calendar day in UTC+14', async () => {
		const previousTimezone = process.env.TZ;
		process.env.TZ = 'Pacific/Kiritimati';
		try {
			const iso = inputDateToIso('2026-09-19');
			if (iso === null) throw new Error('expected a valid date');
			const date = new Date(iso);
			const parts = Object.fromEntries(
				new Intl.DateTimeFormat('en', {
					timeZone: 'Pacific/Kiritimati',
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
				})
					.formatToParts(date)
					.map(({ type, value }) => [type, value]),
			);
			expect(`${parts.year}-${parts.month}-${parts.day}`).toBe('2026-09-19');
		} finally {
			if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
			else process.env.TZ = previousTimezone;
		}
	});

	test('preserves date data when clearing subscriptions and editing calendar events', () => {
		expect(inputDateToIso('')).toBeNull();
		expect(normalizeEventDateTime('2026-09-22T14:00', true)).toBe('2026-09-22T00:00');
		expect(
			validateEventForm({
				title: 'WG-Meeting',
				startsAt: '2026-09-22T14:00',
				endsAt: '2026-09-22T00:00',
				allDay: true,
			}),
		).toMatchObject({ ok: true });
	});

	for (const timezone of ['UTC', 'Europe/Berlin', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
		test(`all-day storage, editing, display and ICS retain the calendar day in ${timezone}`, () => {
			const previousTimezone = process.env.TZ;
			process.env.TZ = timezone;
			try {
				for (const day of ['2026-09-22', '2026-03-29', '2026-10-25']) {
					const validation = validateEventForm({
						title: 'Geburtstag',
						startsAt: `${day}T14:00`,
						endsAt: `${day}T00:00`,
						allDay: true,
					});
					if (!validation.ok) throw new Error(validation.error);
					expect(validation.startsAt.toISOString()).toBe(`${day}T00:00:00.000Z`);
					expect(validation.endsAt?.toISOString()).toBe(`${day}T00:00:00.000Z`);
					const display = eventDateForDisplay(`${day}T00:00:00.000Z`, true);
					const pad = (n: number) => String(n).padStart(2, '0');
					const displayedDay = `${display.getFullYear()}-${pad(display.getMonth() + 1)}-${pad(display.getDate())}`;
					expect(displayedDay).toBe(day);
					const edited = validateEventForm({
						title: 'Nur Titel geändert',
						startsAt: `${displayedDay}T00:00`,
						endsAt: '',
						allDay: true,
					});
					if (!edited.ok) throw new Error(edited.error);
					expect(edited.startsAt.toISOString()).toBe(`${day}T00:00:00.000Z`);
					const event: EventInput = {
						id: 'all-day',
						title: 'Geburtstag',
						description: null,
						startsAt: validation.startsAt.toISOString(),
						endsAt: null,
						allDay: true,
						location: null,
						recurrence: null,
					};
					const [occurrence] = expandRecurrence(event, `${day}T00:00:00Z`, `${day}T23:59:59Z`);
					if (!occurrence) throw new Error('expected all-day occurrence');
					expect(occurrenceToIcs(occurrence)).toContain(
						`DTSTART;VALUE=DATE:${day.replaceAll('-', '')}\r\n`,
					);
					expect(formatEventTimeRange(occurrence)).toContain(
						`${day.slice(8)}.${day.slice(5, 7)}.${day.slice(0, 4)} · ganztägig`,
					);
					const timed = validateEventForm({
						title: 'Mit Uhrzeit',
						startsAt: `${day}T14:00`,
						endsAt: '',
						allDay: false,
					});
					if (!timed.ok) throw new Error(timed.error);
					expect(timed.startsAt.toISOString()).toBe(new Date(`${day}T14:00`).toISOString());
					expect(eventDateForDisplay(timed.startsAt.toISOString(), false).getTime()).toBe(
						timed.startsAt.getTime(),
					);
				}
				const bounds = getMonthBounds(new Date(2026, 8, 15));
				expect(bounds.start.getTime()).toBeLessThanOrEqual(Date.parse('2026-09-01T00:00:00Z'));
				expect(bounds.end.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-09-30T23:59:59.999Z'));
			} finally {
				if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
				else process.env.TZ = previousTimezone;
			}
		});
	}

	for (const timezone of ['UTC', 'Europe/Berlin']) {
		test(`all-day recurrence crosses both Berlin DST changes without duplicate days in ${timezone}`, () => {
			const previousTimezone = process.env.TZ;
			process.env.TZ = timezone;
			try {
				for (const days of [
					['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'],
					['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'],
				]) {
					const validation = validateEventForm({
						title: 'Täglich',
						startsAt: `${days[0]}T14:00`,
						endsAt: '',
						allDay: true,
					});
					if (!validation.ok) throw new Error(validation.error);
					const occurrences = expandRecurrence(
						{
							id: 'daily',
							title: 'Täglich',
							description: null,
							startsAt: validation.startsAt.toISOString(),
							endsAt: null,
							allDay: true,
							location: null,
							recurrence: 'FREQ=DAILY;COUNT=4',
						},
						`${days[0]}T00:00:00Z`,
						`${days[3]}T23:59:59Z`,
					);
					expect(occurrences.map((occurrence) => occurrence.startsAt.slice(0, 10))).toEqual(days);
					expect(
						occurrences.map((occurrence) =>
							eventDateForDisplay(occurrence.startsAt, true).getDate(),
						),
					).toEqual(days.map((day) => Number(day.slice(-2))));
					for (const [index, occurrence] of occurrences.entries()) {
						expect(occurrenceToIcs(occurrence)).toContain(
							`DTSTART;VALUE=DATE:${days[index]?.replaceAll('-', '')}\r\n`,
						);
					}
				}
			} finally {
				if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
				else process.env.TZ = previousTimezone;
			}
		});
	}

	test('timed recurrence retains Berlin wall time across both DST changes', () => {
		for (const start of ['2026-03-28T19:00:00Z', '2026-10-24T18:00:00Z']) {
			const occurrences = expandRecurrence(
				{
					id: 'timed',
					title: 'WG-Meeting',
					description: null,
					startsAt: start,
					endsAt: null,
					allDay: false,
					location: null,
					recurrence: 'FREQ=DAILY;COUNT=4',
				},
				start,
				new Date(Date.parse(start) + 5 * 24 * 60 * 60 * 1000),
			);
			const wallTime = new Intl.DateTimeFormat('en-GB', {
				timeZone: 'Europe/Berlin',
				hour: '2-digit',
				minute: '2-digit',
			});
			expect(
				occurrences.map((occurrence) => wallTime.format(new Date(occurrence.startsAt))),
			).toEqual(['20:00', '20:00', '20:00', '20:00']);
		}
	});

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
		await page.getByRole('button', { name: 'Schließen · Entwurf behalten', exact: true }).click();
		await open.click();
		await expect(page.locator('#event-create-title')).toHaveValue('Entwurf bleibt');
		await expect(page.locator('#event-create-start')).toHaveValue('2026-09-25T18:00');
		await expect(page.locator('#event-create-end')).toHaveValue('2026-09-25T20:00');
		await page.locator('#event-create-start').fill('');
		await page.getByRole('button', { name: 'Schließen · Entwurf behalten', exact: true }).click();
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

	test('mention autocomplete does not open for an isolated at-sign', () => {
		expect(detectMention('@', 1)).toBeNull();
		expect(detectMention('@ ', 1)).toBeNull();
		expect(detectMention('Hallo @M', 8)).toEqual({ query: 'M', startIndex: 6 });
		// Namen mit Umlaut-fremden Buchstaben bleiben bis zum Ende des Namens auswählbar.
		expect(detectMention('Hi @René', 8)).toEqual({ query: 'René', startIndex: 3 });
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
				await page.evaluate((scale) => {
					if (scale === '200%') {
						document.documentElement.style.fontSize = '32px';
					} else {
						document.documentElement.style.removeProperty('font-size');
					}
				}, textScale);

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

		const homeLink = page.getByRole('link', { name: 'Alle Bereiche ansehen' });
		await expect(homeLink).toBeVisible();
		await expect(homeLink).toHaveAttribute('href', '/');
		await homeLink.focus();
		await expect(homeLink).toBeFocused();
	});
});

test.describe('marker mobile overflow', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	async function setTextScale(page: Page) {
		await page.evaluate(() => {
			const nonce = document.querySelector('script[nonce]')?.nonce;
			if (!nonce) throw new Error('CSP nonce not found');
			const style = document.createElement('style');
			style.nonce = nonce;
			style.textContent = 'html { font-size: 200% !important; }';
			document.head.append(style);
		});
	}

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
				await setTextScale(page);

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
				await setTextScale(page);
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
