// Calendar dates: all-day and timed events across Berlin DST and extreme time zones, recurrence
// and ICS. A calendar day must be identical for every device time zone.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inputDateToIso } from '../src/core/utils/local-date';
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
import { assertMatchObject } from './support/match-object';

describe('calendar fixes', () => {
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

		assert.equal(occurrences.length, 1);
		assertMatchObject(occurrences[0], {
			startsAt: '2026-10-24T00:00:00.000Z',
			endsAt: '2026-10-25T00:00:00.000Z',
		});
	});

	test('uses Berlin calendar boundaries for all-day overlap and recurrence search', () => {
		const previousTimezone = process.env.TZ;
		process.env.TZ = 'Europe/Berlin';
		try {
			assert.equal(
				expandAgenda(ALL_DAY_EVENT, '2026-09-28T22:01:00.000Z', '2026-09-28T23:00:00.000Z').length,
				1,
			);
			assert.equal(
				expandAgenda(ALL_DAY_EVENT, '2026-09-29T22:30:00.000Z', '2026-09-29T23:00:00.000Z').length,
				0,
			);

			const fallDstEvent = { ...ALL_DAY_EVENT, startsAt: '2026-10-25T00:00:00.000Z' };
			assert.equal(
				expandAgenda(fallDstEvent, '2026-10-24T22:30:00.000Z', '2026-10-24T23:00:00.000Z').length,
				1,
			);
			assert.equal(
				expandAgenda(fallDstEvent, '2026-10-25T23:30:00.000Z', '2026-10-26T00:00:00.000Z').length,
				0,
			);

			const daily = {
				...ALL_DAY_EVENT,
				recurrence: 'FREQ=DAILY;COUNT=2',
			};
			assert.deepEqual(
				expandAgenda(daily, '2026-09-29T22:30:00.000Z', '2026-09-29T23:00:00.000Z').map(
					(occurrence) => occurrence.startsAt,
				),
				['2026-09-30T00:00:00.000Z'],
			);
		} finally {
			if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
			else process.env.TZ = previousTimezone;
		}
	});

	test('uses the runtime local calendar date before a UTC+14 event marker', () => {
		const previousTimezone = process.env.TZ;
		process.env.TZ = 'Pacific/Kiritimati';
		try {
			assert.equal(
				expandAgenda(
					{ ...ALL_DAY_EVENT, startsAt: '2026-01-01T00:00:00.000Z' },
					'2025-12-31T10:30:00.000Z',
					'2025-12-31T11:00:00.000Z',
				).length,
				1,
			);
			assert.equal(
				expandAgenda(
					{ ...ALL_DAY_EVENT, startsAt: '2026-01-01T00:00:00.000Z' },
					'2026-01-01T10:30:00.000Z',
					'2026-01-01T11:00:00.000Z',
				).length,
				0,
			);
		} finally {
			if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
			else process.env.TZ = previousTimezone;
		}
	});

	test('cron Berlin window excludes a finished all-day event on a UTC host', () => {
		const window = computeTomorrowUtcWindow(new Date('2026-09-29T09:00:00.000Z'));
		assert.equal(window.start.toISOString(), '2026-09-29T22:00:00.000Z');
		assert.equal(expandRecurrence(ALL_DAY_EVENT, window.start, window.end).length, 0);
	});
});

describe('date compatibility', () => {
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
				// Legacy rows hold device-local midnight or the time retained after toggling all-day.
				for (const time of ['00:00', '14:37']) {
					const legacy = event(
						new Date(`2026-09-22T${time}`).toISOString(),
						new Date('2026-09-23T15:41').toISOString(),
					);
					assert.equal(inputDate(legacy.startsAt), '2026-09-22T00:00');
					const [occurrence] = expandRecurrence(legacy, '2026-09-01', '2026-10-01');
					if (!occurrence) throw new Error('expected legacy occurrence');
					assert.ok(formatEventTimeRange(occurrence).includes('22.09.2026 · ganztägig'));
					const edited = validateEventForm({
						title: 'Nur Titel geändert',
						startsAt: inputDate(legacy.startsAt),
						endsAt: inputDate(legacy.endsAt as string),
						allDay: true,
						original: legacy,
					});
					if (!edited.ok) throw new Error(edited.error);
					assert.equal(edited.startsAt.toISOString(), legacy.startsAt);
					assert.equal(edited.endsAt?.toISOString(), legacy.endsAt);
					const changed = validateEventForm({
						title: legacy.title,
						startsAt: '2026-09-23T00:00',
						endsAt: '2026-09-23T00:00',
						allDay: true,
						original: legacy,
					});
					if (!changed.ok) throw new Error(changed.error);
					assert.equal(changed.startsAt.toISOString(), '2026-09-23T00:00:00.000Z');
					assert.equal(changed.endsAt?.toISOString(), '2026-09-23T00:00:00.000Z');
				}
				// No format/version marker exists: exact UTC midnight always means the UTC date,
				// including indistinguishable legacy midnight values. Never infer the original zone.
				assert.equal(inputDate('2026-09-22T00:00:00.000Z'), '2026-09-22T00:00');
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
									assert.equal(occurrences.length, 1);
									assert.equal(occurrences[0]?.startsAt, startsAt);
								}
								const tomorrow = new Date(last.getTime() + 1);
								assert.deepEqual(
									expandAgendaRecurrence(stored, tomorrow, new Date(tomorrow.getTime() + 1)),
									[],
								);
								assert.deepEqual(
									expandAgendaRecurrence(
										stored,
										new Date(first.getTime() - 1),
										new Date(first.getTime() - 1),
									),
									[],
								);
								const queryBounds = getCalendarDayBounds(first);
								assert.ok(queryBounds.start.getTime() <= Date.parse(startsAt));
								assert.ok(queryBounds.end.getTime() >= Date.parse(startsAt));
							}
						}
					}
					const timed = { ...event(new Date(`${day}T08:00`).toISOString()), allDay: false };
					assert.deepEqual(
						expandAgendaRecurrence(timed, new Date(`${day}T12:00`), new Date(`${day}T23:59`)),
						[],
					);
					const equalEnd = event(`${day}T00:00:00.000Z`, `${day}T00:00:00.000Z`);
					const [occurrence] = expandAgendaRecurrence(
						equalEnd,
						new Date(`${day}T12:00`),
						new Date(`${day}T23:59`),
					);
					if (!occurrence) throw new Error('expected same-day occurrence');
					assert.equal(occurrence.endsAt, equalEnd.endsAt);
					const next = new Date(`${day}T00:00Z`);
					next.setUTCDate(next.getUTCDate() + 1);
					assert.ok(
						occurrenceToIcs(occurrence).includes(
							`DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replaceAll('-', '')}\r\n`,
						),
					);
				}
			} finally {
				if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
				else process.env.TZ = previousTimezone;
			}
		});
	}
});

describe('calendar date and recurrence regressions', () => {
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
			assert.equal(`${parts.year}-${parts.month}-${parts.day}`, '2026-09-19');
		} finally {
			if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
			else process.env.TZ = previousTimezone;
		}
	});

	test('preserves date data when clearing subscriptions and editing calendar events', () => {
		assert.equal(inputDateToIso(''), null);
		assert.equal(normalizeEventDateTime('2026-09-22T14:00', true), '2026-09-22T00:00');
		assertMatchObject(
			validateEventForm({
				title: 'WG-Meeting',
				startsAt: '2026-09-22T14:00',
				endsAt: '2026-09-22T00:00',
				allDay: true,
			}),
			{ ok: true },
		);
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
					assert.equal(validation.startsAt.toISOString(), `${day}T00:00:00.000Z`);
					assert.equal(validation.endsAt?.toISOString(), `${day}T00:00:00.000Z`);
					const display = eventDateForDisplay(`${day}T00:00:00.000Z`, true);
					const pad = (n: number) => String(n).padStart(2, '0');
					const displayedDay = `${display.getFullYear()}-${pad(display.getMonth() + 1)}-${pad(display.getDate())}`;
					assert.equal(displayedDay, day);
					const edited = validateEventForm({
						title: 'Nur Titel geändert',
						startsAt: `${displayedDay}T00:00`,
						endsAt: '',
						allDay: true,
					});
					if (!edited.ok) throw new Error(edited.error);
					assert.equal(edited.startsAt.toISOString(), `${day}T00:00:00.000Z`);
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
					assert.ok(
						occurrenceToIcs(occurrence).includes(
							`DTSTART;VALUE=DATE:${day.replaceAll('-', '')}\r\n`,
						),
					);
					assert.ok(
						formatEventTimeRange(occurrence).includes(
							`${day.slice(8)}.${day.slice(5, 7)}.${day.slice(0, 4)} · ganztägig`,
						),
					);
					const timed = validateEventForm({
						title: 'Mit Uhrzeit',
						startsAt: `${day}T14:00`,
						endsAt: '',
						allDay: false,
					});
					if (!timed.ok) throw new Error(timed.error);
					assert.equal(timed.startsAt.toISOString(), new Date(`${day}T14:00`).toISOString());
					assert.equal(
						eventDateForDisplay(timed.startsAt.toISOString(), false).getTime(),
						timed.startsAt.getTime(),
					);
				}
				const bounds = getMonthBounds(new Date(2026, 8, 15));
				assert.ok(bounds.start.getTime() <= Date.parse('2026-09-01T00:00:00Z'));
				assert.ok(bounds.end.getTime() >= Date.parse('2026-09-30T23:59:59.999Z'));
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
					assert.deepEqual(
						occurrences.map((occurrence) => occurrence.startsAt.slice(0, 10)),
						days,
					);
					assert.deepEqual(
						occurrences.map((occurrence) =>
							eventDateForDisplay(occurrence.startsAt, true).getDate(),
						),
						days.map((day) => Number(day.slice(-2))),
					);
					for (const [index, occurrence] of occurrences.entries()) {
						assert.ok(
							occurrenceToIcs(occurrence).includes(
								`DTSTART;VALUE=DATE:${days[index]?.replaceAll('-', '')}\r\n`,
							),
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
			assert.deepEqual(
				occurrences.map((occurrence) => wallTime.format(new Date(occurrence.startsAt))),
				['20:00', '20:00', '20:00', '20:00'],
			);
		}
	});
});
