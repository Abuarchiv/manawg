import { mutationError } from '@/core/http/error-codes';
import type { Message } from '@/shared/i18n/message';

function withSubject(subject: Message, detail: Message): Message {
	return { key: 'common.errors.withSubject', values: { subject, detail } };
}

/** Offline, 429, maintenance, expired session and missing permission each need a concrete next step. */
export function eventSaveError(subject: Message, res: { status: number; error: string }): Message {
	// The API lets only the creator and WG admins change or delete an event.
	if (res.status === 403) return withSubject(subject, { key: 'events.errors.notAllowed' });
	if (res.error === 'event_changed') {
		return withSubject(subject, { key: 'events.errors.eventChanged' });
	}
	if (res.error === 'occurrence_changed' || res.error === 'occurrence_not_found') {
		return { key: 'events.errors.occurrenceChanged' };
	}
	if (res.status === 404 && res.error !== 'wg_not_found') {
		return withSubject(subject, { key: 'events.errors.gone' });
	}
	return mutationError(
		subject,
		res.error,
		{},
		{ key: 'events.errors.sentence', values: { subject } },
	);
}

/** Someone else deleted the event meanwhile; restoring it locally would be wrong. */
export function isEventGone(res: { status: number; error: string }): boolean {
	return res.status === 404 && res.error === 'event_not_found';
}
