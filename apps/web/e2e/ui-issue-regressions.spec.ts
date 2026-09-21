import { expect, test } from '@playwright/test';
import { activityItemKey } from '../src/core/reads/activity';
import { inputDateToIso } from '../src/core/utils/local-date';
import { detectMention } from '../src/features/chat/chat-pure';
import {
	type EventInput,
	eventDateForDisplay,
	expandRecurrence,
	formatEventTimeRange,
	getMonthBounds,
	normalizeEventDateTime,
	validateEventForm,
} from '../src/features/events/events';
import { occurrenceToIcs } from '../src/features/events/ics';
import { FIXTURE_WG, navigateToFeature, setupMember } from './_helpers';

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
					occurrences.map((occurrence) => eventDateForDisplay(occurrence.startsAt, true).getDate()),
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
		expect(occurrences.map((occurrence) => wallTime.format(new Date(occurrence.startsAt)))).toEqual(
			['20:00', '20:00', '20:00', '20:00'],
		);
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

test('activity keys stay unique when rows have identical display text', () => {
	const item = {
		kind: 'audit',
		timestamp: '2026-09-19T10:00:00.000Z',
		memberName: 'Abu',
		text: 'hat etwas geändert',
	};

	expect(activityItemKey(item, 0)).not.toBe(activityItemKey(item, 1));
	expect(activityItemKey({ ...item, id: 'audit-1' }, 0)).toBe('audit-1');
});

test('mention autocomplete does not open for an isolated at-sign', () => {
	expect(detectMention('@', 1)).toBeNull();
	expect(detectMention('@ ', 1)).toBeNull();
	expect(detectMention('Hallo @M', 8)).toEqual({ query: 'M', startIndex: 6 });
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
