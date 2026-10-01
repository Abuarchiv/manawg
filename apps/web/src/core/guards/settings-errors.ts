import {
	isAuthInvalidated,
	isInvalidShareCode,
	isNetworkError,
	isRetryableServerError,
	isWgUnavailable,
} from '@/core/http/error-codes';

export async function readResponseErrorCode(response: Response): Promise<string | null> {
	try {
		const body = (await response.clone().json()) as { code?: unknown; error?: unknown };
		if (typeof body.code === 'string') return body.code;
		if (typeof body.error === 'string') return body.error;
	} catch {
		return null;
	}
	return null;
}

export function accessErrorMessage(status: number, code: string | null): string {
	if (isNetworkError(code, status)) {
		return 'Zugang konnte nicht geändert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (isWgUnavailable(code, status)) {
		return 'Diese WG wurde nicht gefunden. Öffne sie über den aktuellen WG-Link erneut.';
	}
	if (isInvalidShareCode(code)) {
		return 'Der WG-Code ist ungültig. Öffne die WG über einen gültigen Link.';
	}
	if (isRetryableServerError(code, status) || code === 'share_code_generation_failed') {
		return 'Zugang konnte nicht geändert werden: Versuche es gleich erneut.';
	}
	if (isAuthInvalidated(code, status)) {
		return 'Deine lokale Mitgliedschaft ist nicht mehr gültig. Tritt der WG erneut bei.';
	}
	return 'Zugang konnte nicht geändert werden.';
}

export function deleteWgErrorMessage(status: number, code: string | null): string {
	// Worth being explicit here above all: on a dropped connection the request
	// may or may not have reached the server, and "Löschen fehlgeschlagen"
	// would tell the user the WG still exists when it might not.
	if (isNetworkError(code, status)) {
		return 'Keine Verbindung — ob die WG gelöscht wurde, ist unklar. Lade die Seite neu und prüfe es.';
	}
	if (isWgUnavailable(code, status)) {
		return 'Diese WG wurde nicht gefunden. Sie wurde möglicherweise schon gelöscht oder der Link ist veraltet.';
	}
	if (isInvalidShareCode(code)) {
		return 'Der WG-Code ist ungültig. Öffne die WG über einen gültigen Link.';
	}
	if (isRetryableServerError(code, status)) {
		return 'WG konnte nicht gelöscht werden: Versuche es gleich erneut.';
	}
	if (isAuthInvalidated(code, status)) {
		return 'Deine lokale Mitgliedschaft ist nicht mehr gültig. Tritt der WG erneut bei.';
	}
	return 'Löschen fehlgeschlagen. Bitte später erneut versuchen.';
}

export function notificationSaveErrorMessage(status: number, code: string | null): string {
	if (isNetworkError(code, status)) {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (isRetryableServerError(code, status)) {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (code === 'insert_failed') {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (code === 'member_not_found') {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (isWgUnavailable(code, status) || isInvalidShareCode(code)) {
		// withWgRoute -> readShareCode rejects a malformed code before the body
		// is even parsed, so this route really can answer `invalid_share_code`.
		// Its four siblings handled that; this one fell through to the generic
		// message.
		return 'Benachrichtigungen konnten nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (isAuthInvalidated(code, status)) {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (code === 'quiet_hours_invalid') {
		return 'Ruhezeiten konnten nicht gespeichert werden: Wähle Stunden zwischen 0 und 23.';
	}
	if (code === 'invalid_body' || code === 'invalid_json') {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Die Anfrage war ungültig.';
	}
	return 'Benachrichtigungseinstellung konnte nicht gespeichert werden.';
}

export function notificationTestErrorMessage(status: number, code: string | null): string {
	if (isNetworkError(code, status)) {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (isRetryableServerError(code, status)) {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Versuche es gleich erneut.';
	}
	if (isWgUnavailable(code, status)) {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (isInvalidShareCode(code)) {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Der WG-Code ist ungültig.';
	}
	if (isAuthInvalidated(code, status)) {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Tritt der WG erneut bei.';
	}
	return 'Test konnte nicht gesendet werden.';
}

export function exportErrorMessage(status: number, code: string | null): string {
	if (isNetworkError(code, status)) {
		return 'Export konnte nicht erstellt werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (isRetryableServerError(code, status)) {
		return 'Export konnte nicht erstellt werden: Versuche es gleich erneut.';
	}
	if (isWgUnavailable(code, status)) {
		return 'Export konnte nicht erstellt werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (isInvalidShareCode(code)) {
		return 'Export konnte nicht erstellt werden: Der WG-Code ist ungültig.';
	}
	if (code === 'section_invalid') {
		return 'Export konnte nicht erstellt werden: Wähle einen gültigen CSV-Bereich.';
	}
	if (isAuthInvalidated(code, status)) {
		return 'Export konnte nicht erstellt werden: Tritt der WG erneut bei.';
	}
	return 'Export konnte nicht erstellt werden.';
}
