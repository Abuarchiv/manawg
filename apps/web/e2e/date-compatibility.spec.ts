import { expect, test } from '@playwright/test';
import {
	type EventInput,
	eventDateForDisplay,
	expandAgendaRecurrence,
	expandRecurrence,
	formatEventTimeRange,
	getCalendarDayBounds,
	validateEventForm,
} from '../src/features/events/events';
import { occurrenceToIcs } from '../src/features/events/ics';

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
