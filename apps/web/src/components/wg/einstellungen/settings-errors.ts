import {
	type ApiErrorKind,
	classifyApiError,
	READ_ONLY_MESSAGE,
	SESSION_EXPIRED_MESSAGE,
} from '@/core/http/error-codes';

type KindMessages = Partial<Record<ApiErrorKind, string>>;

function messageFor(
	messages: KindMessages,
	fallback: string,
	status: number,
	code: string | null,
	kind: ApiErrorKind | null = classifyApiError(code, status),
): string {
	return (kind && messages[kind]) || fallback;
}

// Worth being explicit here above all: on a dropped connection the request
// may or may not have reached the server, and "Löschen fehlgeschlagen"
// would tell the user the WG still exists when it might not.
const DELETE_WG_MESSAGES: KindMessages = {
	network:
		'Keine Verbindung — ob die WG gelöscht wurde, ist unklar. Lade die Seite neu und prüfe es.',
	wgUnavailable:
		'Diese WG wurde nicht gefunden. Sie wurde möglicherweise schon gelöscht oder der Link ist veraltet.',
	invalidShareCode: 'Der WG-Code ist ungültig. Öffne die WG über einen gültigen Link.',
	retryable: 'WG konnte nicht gelöscht werden: Versuche es gleich erneut.',
	authInvalidated: 'Deine lokale Mitgliedschaft ist nicht mehr gültig. Tritt der WG erneut bei.',
};

export function deleteWgErrorMessage(status: number, code: string | null): string {
	return messageFor(
		DELETE_WG_MESSAGES,
		'Löschen fehlgeschlagen. Bitte versuche es später erneut.',
		status,
		code,
	);
}

const NOTIFICATION_SAVE_MESSAGES: Record<ApiErrorKind, string> = {
	network:
		'Benachrichtigungen konnten nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
	retryable: 'Benachrichtigungen konnten nicht gespeichert werden: Versuche es gleich erneut.',
	// withWgRoute -> readShareCode rejects a malformed code before the body is
	// even parsed, so this route really can answer `invalid_share_code`.
	wgUnavailable:
		'Benachrichtigungen konnten nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.',
	invalidShareCode:
		'Benachrichtigungen konnten nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.',
	authInvalidated: 'Benachrichtigungen konnten nicht gespeichert werden: Tritt der WG erneut bei.',
	readOnly: `Benachrichtigungen konnten nicht gespeichert werden: ${READ_ONLY_MESSAGE}`,
	sessionExpired: `Benachrichtigungen konnten nicht gespeichert werden: ${SESSION_EXPIRED_MESSAGE}`,
};

export function notificationSaveErrorMessage(status: number, code: string | null): string {
	if (code === 'insert_failed') return NOTIFICATION_SAVE_MESSAGES.retryable;
	if (code === 'member_not_found') return NOTIFICATION_SAVE_MESSAGES.authInvalidated;
	const kind = classifyApiError(code, status);
	if (kind) return NOTIFICATION_SAVE_MESSAGES[kind];
	if (code === 'quiet_hours_invalid') {
		return 'Ruhezeiten konnten nicht gespeichert werden: Wähle Stunden zwischen 0 und 23.';
	}
	if (code === 'invalid_body' || code === 'invalid_json') {
		return 'Benachrichtigungen konnten nicht gespeichert werden: Die Anfrage war ungültig.';
	}
	return 'Benachrichtigungseinstellung konnte nicht gespeichert werden.';
}

const NOTIFICATION_TEST_MESSAGES: KindMessages = {
	network:
		'Testbenachrichtigung konnte nicht gesendet werden: Prüfe deine Verbindung und versuche es erneut.',
	retryable: 'Testbenachrichtigung konnte nicht gesendet werden: Versuche es gleich erneut.',
	wgUnavailable:
		'Testbenachrichtigung konnte nicht gesendet werden: Öffne die WG über den aktuellen Link erneut.',
	invalidShareCode: 'Testbenachrichtigung konnte nicht gesendet werden: Der WG-Code ist ungültig.',
	authInvalidated: 'Testbenachrichtigung konnte nicht gesendet werden: Tritt der WG erneut bei.',
};

export function notificationTestErrorMessage(status: number, code: string | null): string {
	if (code === 'no_push_subscription') {
		return 'Dieses Gerät ist nicht mehr für Push angemeldet. Schalte Push-Benachrichtigungen aus und wieder ein.';
	}
	return messageFor(NOTIFICATION_TEST_MESSAGES, 'Test konnte nicht gesendet werden.', status, code);
}

const EXPORT_MESSAGES: KindMessages = {
	network: 'Export konnte nicht erstellt werden: Prüfe deine Verbindung und versuche es erneut.',
	retryable: 'Export konnte nicht erstellt werden: Versuche es gleich erneut.',
	wgUnavailable:
		'Export konnte nicht erstellt werden: Öffne die WG über den aktuellen Link erneut.',
	invalidShareCode: 'Export konnte nicht erstellt werden: Der WG-Code ist ungültig.',
	authInvalidated: 'Export konnte nicht erstellt werden: Tritt der WG erneut bei.',
};

export function exportErrorMessage(status: number, code: string | null): string {
	if (code === 'section_invalid') {
		return 'Export konnte nicht erstellt werden: Wähle einen gültigen CSV-Bereich.';
	}
	return messageFor(EXPORT_MESSAGES, 'Export konnte nicht erstellt werden.', status, code);
}
