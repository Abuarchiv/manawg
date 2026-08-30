import type { EventOccurrence } from '@/features/events/events';
import { occurrenceToIcs } from '@/features/events/ics';
import { describe, expect, it } from 'vitest';

function occurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
	return {
		eventId: 'evt-1',
		title: 'Bad putzen',
		description: null,
		startsAt: '2026-08-31T18:00:00.000Z',
		endsAt: '2026-08-31T19:00:00.000Z',
		allDay: false,
		location: null,
		recurring: false,
		occurrenceIndex: 0,
		...overrides,
	};
}

describe('occurrenceToIcs', () => {
	it('emits a valid single-event VCALENDAR with UTC timestamps', () => {
		const ics = occurrenceToIcs(occurrence());
		expect(ics).toContain('BEGIN:VCALENDAR');
		expect(ics).toContain('BEGIN:VEVENT');
		expect(ics).toContain('UID:evt-1-0@manawg.app');
		expect(ics).toContain('DTSTART:20260831T180000Z');
		expect(ics).toContain('DTEND:20260831T190000Z');
		expect(ics).toContain('SUMMARY:Bad putzen');
		expect(ics).toContain('END:VEVENT');
		expect(ics).toContain('END:VCALENDAR');
		expect(ics.endsWith('\r\n')).toBe(true);
	});

	it('uses a DATE value and exclusive end for all-day events', () => {
		const ics = occurrenceToIcs(
			occurrence({ allDay: true, startsAt: '2026-09-01T00:00:00.000Z', endsAt: null }),
		);
		expect(ics).toContain('DTSTART;VALUE=DATE:20260901');
		expect(ics).toContain('DTEND;VALUE=DATE:20260902');
	});

	it('escapes commas, semicolons, backslashes and newlines in text fields', () => {
		const ics = occurrenceToIcs(
			occurrence({ title: 'Miete; Nebenkosten, Extra\nZeile\\Pfad', location: null }),
		);
		expect(ics).toContain('SUMMARY:Miete\\; Nebenkosten\\, Extra\\nZeile\\\\Pfad');
	});

	it('includes description and location only when present', () => {
		const withBoth = occurrenceToIcs(occurrence({ description: 'Notiz', location: 'Küche' }));
		expect(withBoth).toContain('DESCRIPTION:Notiz');
		expect(withBoth).toContain('LOCATION:Küche');
		const withoutEither = occurrenceToIcs(occurrence());
		expect(withoutEither).not.toContain('DESCRIPTION:');
		expect(withoutEither).not.toContain('LOCATION:');
	});

	it('folds lines longer than 75 octets per RFC 5545', () => {
		const longTitle = 'A'.repeat(120);
		const ics = occurrenceToIcs(occurrence({ title: longTitle }));
		const physicalLines = ics.split('\r\n');
		for (const line of physicalLines) {
			expect(line.length).toBeLessThanOrEqual(75);
		}
		const unfolded = ics.replace(/\r\n /g, '');
		expect(unfolded).toContain(`SUMMARY:${longTitle}`);
	});
});
