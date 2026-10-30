import type { wgEvents } from '@/core/db';
import { isEventYearInRange } from '@/features/events/event-limits';
import type { Message } from '@/shared/i18n/message';

/** Wire shape of a calendar event: dates as ISO strings, everything else as stored. */
export function serializeWgEvent(row: typeof wgEvents.$inferSelect) {
	return {
		id: row.id,
		wgId: row.wgId,
		title: row.title,
		description: row.description,
		startsAt: row.startsAt.toISOString(),
		endsAt: row.endsAt ? row.endsAt.toISOString() : null,
		allDay: row.allDay,
		location: row.location,
		recurrence: row.recurrence,
		createdByMemberId: row.createdByMemberId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export type SerializedWgEvent = ReturnType<typeof serializeWgEvent>;

/** Value of an `<input type="datetime-local">`: local wall time as `YYYY-MM-DDTHH:mm`. */
export function toDatetimeLocalValue(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type EventFormValidation =
	| { ok: true; startsAt: Date; endsAt: Date | null }
	| { ok: false; error: Message; field: 'title' | 'startsAt' | 'endsAt' };

export function normalizeEventDateTime(value: string, allDay: boolean): string {
	if (!allDay || value.length < 10) return value;
	return `${value.slice(0, 10)}T00:00`;
}

/**
 * The three checks both event modals ran before submitting, in the order they
 * report them. Pure, so the rules can be tested without rendering a dialog.
 */
export function validateEventForm(input: {
	title: string;
	startsAt: string;
	endsAt: string;
	allDay?: boolean;
}): EventFormValidation {
	if (input.title.trim().length === 0) {
		return { ok: false, error: { key: 'events.form.errors.titleMissing' }, field: 'title' };
	}
	if (!input.startsAt) {
		return { ok: false, error: { key: 'events.form.errors.startMissing' }, field: 'startsAt' };
	}

	const allDay = input.allDay === true;
	const startsAt = new Date(
		`${normalizeEventDateTime(input.startsAt, allDay)}${allDay ? 'Z' : ''}`,
	);
	const endsAt = input.endsAt
		? new Date(`${normalizeEventDateTime(input.endsAt, allDay)}${allDay ? 'Z' : ''}`)
		: null;
	if (!isEventYearInRange(startsAt)) {
		return { ok: false, error: { key: 'events.form.errors.startInvalid' }, field: 'startsAt' };
	}
	if (endsAt && !isEventYearInRange(endsAt)) {
		return { ok: false, error: { key: 'events.form.errors.endInvalid' }, field: 'endsAt' };
	}
	if (endsAt && endsAt.getTime() < startsAt.getTime()) {
		return { ok: false, error: { key: 'events.form.errors.endBeforeStart' }, field: 'endsAt' };
	}
	return { ok: true, startsAt, endsAt };
}
