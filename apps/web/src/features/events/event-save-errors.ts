import { mutationErrorMessage } from '@/core/http/error-codes';

/** Offline, 429, maintenance, expired session and missing permission each need a concrete next step. */
export function eventSaveError(base: string, res: { status: number; error: string }): string {
	// The API lets only the creator and WG admins change or delete an event.
	if (res.status === 403) {
		return `${base}: Das dürfen nur WG-Admins und wer den Termin angelegt hat.`;
	}
	if (res.error === 'event_changed') {
		return `${base}: Der Termin wurde inzwischen geändert. Öffne ihn erneut.`;
	}
	if (res.error === 'occurrence_changed' || res.error === 'occurrence_not_found') {
		return 'Dieser Termin wurde inzwischen geändert. Die Ansicht wird aktualisiert.';
	}
	if (res.status === 404 && res.error !== 'wg_not_found') {
		return `${base}: Der Termin existiert nicht mehr.`;
	}
	return mutationErrorMessage(base, res.error, {}, `${base}.`);
}

/** Someone else deleted the event meanwhile; restoring it locally would be wrong. */
export function isEventGone(res: { status: number; error: string }): boolean {
	return res.status === 404 && res.error === 'event_not_found';
}
