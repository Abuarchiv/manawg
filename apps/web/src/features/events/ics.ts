import type { EventOccurrence } from '@/features/events/events';

/**
 * RFC 5545 TEXT escaping — backslash first, or the escapes it inserts below
 * would themselves get escaped.
 */
function escapeIcsText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\n/g, '\\n');
}

/** RFC 5545 line folding: continuation lines start with a single space. */
function foldLine(line: string): string {
	if (line.length <= 75) return line;
	let result = line.slice(0, 75);
	let rest = line.slice(75);
	while (rest.length > 0) {
		result += `\r\n ${rest.slice(0, 74)}`;
		rest = rest.slice(74);
	}
	return result;
}

function toIcsUtc(iso: string): string {
	return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function toIcsDate(iso: string): string {
	return iso.slice(0, 10).replace(/-/g, '');
}

/**
 * Serializes one resolved occurrence (not the recurring series) to a single
 * VEVENT — calendar apps get one concrete instance to import, no RRULE
 * translation needed.
 */
export function occurrenceToIcs(occ: EventOccurrence): string {
	const uid = `${occ.eventId}-${occ.occurrenceIndex}@manawg.app`;
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//ManaWG//Kalender//DE',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${uid}`,
		`DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
	];
	if (occ.allDay) {
		lines.push(`DTSTART;VALUE=DATE:${toIcsDate(occ.startsAt)}`);
		// ICS all-day DTEND is exclusive; default to a single-day span.
		const endExclusive = new Date(occ.endsAt ?? occ.startsAt);
		endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
		lines.push(`DTEND;VALUE=DATE:${toIcsDate(endExclusive.toISOString())}`);
	} else {
		lines.push(`DTSTART:${toIcsUtc(occ.startsAt)}`);
		if (occ.endsAt) lines.push(`DTEND:${toIcsUtc(occ.endsAt)}`);
	}
	lines.push(`SUMMARY:${escapeIcsText(occ.title)}`);
	if (occ.description) lines.push(`DESCRIPTION:${escapeIcsText(occ.description)}`);
	if (occ.location) lines.push(`LOCATION:${escapeIcsText(occ.location)}`);
	lines.push('END:VEVENT', 'END:VCALENDAR');
	return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
