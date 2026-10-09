import { RATE_LIMITED_MESSAGE, isNetworkError, isRateLimited } from '@/core/http/error-codes';

/** Offline, 429 and missing permission each need a concrete next step instead of the generic message. */
export function eventSaveError(base: string, res: { status: number; error: string }): string {
	if (isNetworkError(res.error, res.status)) {
		return `${base}: Prüfe deine Verbindung und versuche es erneut.`;
	}
	if (isRateLimited(res.error, res.status)) return RATE_LIMITED_MESSAGE;
	// The API lets only the creator and WG admins change or delete an event.
	if (res.status === 403) {
		return `${base}: Das dürfen nur WG-Admins und wer den Termin angelegt hat.`;
	}
	if (res.error === 'event_changed') {
		return `${base}: Der Termin wurde inzwischen geändert. Öffne ihn erneut.`;
	}
	if (res.status === 404) return `${base}: Der Termin existiert nicht mehr.`;
	return `${base}.`;
}

/** Someone else deleted the event meanwhile; restoring it locally would be wrong. */
export function isEventGone(res: { status: number; error: string }): boolean {
	return res.status === 404 && res.error === 'event_not_found';
}
