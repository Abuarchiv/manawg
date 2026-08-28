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
	if (status === 404 || code === 'wg_not_found') {
		return 'Diese WG wurde nicht gefunden. Öffne sie über den aktuellen WG-Link erneut.';
	}
	if (code === 'invalid_share_code') {
		return 'Der WG-Code ist ungültig. Öffne die WG über einen gültigen Link.';
	}
	if (
		code === 'unexpected_error' ||
		code === 'server_error' ||
		code === 'db_error' ||
		code === 'share_code_generation_failed' ||
		status >= 500
	) {
		return 'Zugang konnte nicht geändert werden: Versuche es gleich erneut.';
	}
	if (
		status === 401 ||
		code === 'not_a_member' ||
		code === 'member_id_required' ||
		code === 'member_id_invalid'
	) {
		return 'Deine lokale Mitgliedschaft ist nicht mehr gültig. Tritt der WG erneut bei.';
	}
	return 'Zugang konnte nicht geändert werden.';
}

export function deleteWgErrorMessage(status: number, code: string | null): string {
	if (status === 404 || code === 'wg_not_found') {
		return 'Diese WG wurde nicht gefunden. Sie wurde möglicherweise schon gelöscht oder der Link ist veraltet.';
	}
	if (code === 'invalid_share_code') {
		return 'Der WG-Code ist ungültig. Öffne die WG über einen gültigen Link.';
	}
	if (
		code === 'unexpected_error' ||
		code === 'server_error' ||
		code === 'db_error' ||
		status >= 500
	) {
		return 'WG konnte nicht gelöscht werden: Versuche es gleich erneut.';
	}
	if (
		status === 401 ||
		code === 'not_a_member' ||
		code === 'member_id_required' ||
		code === 'member_id_invalid'
	) {
		return 'Deine lokale Mitgliedschaft ist nicht mehr gültig. Tritt der WG erneut bei.';
	}
	return 'Löschen fehlgeschlagen. Bitte später erneut versuchen.';
}

export function notificationSaveErrorMessage(status: number, code: string | null): string {
	if (status === 0 || code === 'Netzwerkfehler' || code === 'Failed to fetch') {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (
		code === 'unexpected_error' ||
		code === 'server_error' ||
		code === 'db_error' ||
		status >= 500
	) {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (code === 'insert_failed') {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (code === 'member_not_found') {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (status === 404 || code === 'wg_not_found') {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (
		status === 401 ||
		code === 'not_a_member' ||
		code === 'member_id_required' ||
		code === 'member_id_invalid'
	) {
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
	if (status === 0 || code === 'Netzwerkfehler' || code === 'Failed to fetch') {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (
		code === 'unexpected_error' ||
		code === 'server_error' ||
		code === 'db_error' ||
		status >= 500
	) {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Versuche es gleich erneut.';
	}
	if (status === 404 || code === 'wg_not_found') {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (code === 'invalid_share_code') {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Der WG-Code ist ungültig.';
	}
	if (
		status === 401 ||
		code === 'not_a_member' ||
		code === 'member_id_required' ||
		code === 'member_id_invalid'
	) {
		return 'Testbenachrichtigung konnte nicht gesendet werden: Tritt der WG erneut bei.';
	}
	return 'Test konnte nicht gesendet werden.';
}

export function exportErrorMessage(status: number, code: string | null): string {
	if (status === 0 || code === 'Netzwerkfehler' || code === 'Failed to fetch') {
		return 'Export konnte nicht erstellt werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (code === 'unexpected_error' || code === 'server_error' || status >= 500) {
		return 'Export konnte nicht erstellt werden: Versuche es gleich erneut.';
	}
	if (status === 404 || code === 'wg_not_found') {
		return 'Export konnte nicht erstellt werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (code === 'invalid_share_code') {
		return 'Export konnte nicht erstellt werden: Der WG-Code ist ungültig.';
	}
	if (code === 'section_invalid') {
		return 'Export konnte nicht erstellt werden: Wähle einen gültigen CSV-Bereich.';
	}
	if (
		status === 401 ||
		code === 'not_a_member' ||
		code === 'member_id_required' ||
		code === 'member_id_invalid'
	) {
		return 'Export konnte nicht erstellt werden: Tritt der WG erneut bei.';
	}
	return 'Export konnte nicht erstellt werden.';
}
