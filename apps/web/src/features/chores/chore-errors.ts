import {
	isAuthInvalidated,
	isInvalidShareCode,
	isNetworkError,
	isRetryableServerError,
} from '@/core/http/error-codes';

export function absenceSaveErrorMessage(error: string): string {
	if (isNetworkError(error)) {
		return 'Abwesenheit konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (isRetryableServerError(error)) {
		return 'Abwesenheit konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Abwesenheit konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (isInvalidShareCode(error)) {
		return 'Abwesenheit konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (isAuthInvalidated(error)) {
		return 'Abwesenheit konnte nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (error === 'date_range_invalid') {
		return 'Abwesenheit konnte nicht gespeichert werden: Das Enddatum liegt vor dem Startdatum.';
	}
	if (error === 'reason_invalid') {
		return 'Abwesenheit konnte nicht gespeichert werden: Der Grund darf höchstens 120 Zeichen haben.';
	}
	if (error === 'member_not_in_wg') {
		return 'Abwesenheit konnte nicht gespeichert werden: Dieses Mitglied ist nicht mehr in dieser WG.';
	}
	if (error === 'insert_failed') {
		return 'Abwesenheit konnte nicht gespeichert werden: Prüfe den Putzplan und versuche es erneut.';
	}
	if (error === 'invalid_json' || error === 'invalid_body') {
		return 'Abwesenheit konnte nicht gespeichert werden: Die Anfrage war ungültig.';
	}
	return 'Abwesenheit konnte nicht gespeichert werden.';
}

export function choreCreateErrorMessage(error: string): string {
	if (isNetworkError(error)) {
		return 'Putzaufgabe konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (isRetryableServerError(error)) {
		return 'Putzaufgabe konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (isInvalidShareCode(error)) {
		return 'Putzaufgabe konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (isAuthInvalidated(error)) {
		return 'Putzaufgabe konnte nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (error === 'member_not_in_wg') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Dieses Mitglied ist nicht mehr in dieser WG.';
	}
	if (error === 'interval_invalid') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Das Intervall muss zwischen 1 und 365 Tagen liegen.';
	}
	if (error === 'title_invalid') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Der Titel muss 1 bis 120 Zeichen haben.';
	}
	if (error === 'due_date_invalid') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Das Fälligkeitsdatum ist ungültig.';
	}
	if (error === 'insert_failed') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Prüfe den Putzplan und versuche es erneut.';
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Die Anfrage war ungültig.';
	}
	return 'Hinzufügen fehlgeschlagen. Versuche es gleich erneut.';
}

/** Gemeinsame Fehlertexte für Tausch- und Übernahme-Aktion: `prefix` ist der Satz ohne Punkt. */
export function choreActionErrorMessage(
	prefix: string,
	result: { error: string; status: number },
): string {
	if (result.error === 'unexpected_error' || result.error === 'server_error') {
		return `${prefix}: Versuche es gleich erneut.`;
	}
	if (isNetworkError(result.error, result.status)) {
		return `${prefix}: Prüfe deine Verbindung und versuche es erneut.`;
	}
	return `${prefix}.`;
}
