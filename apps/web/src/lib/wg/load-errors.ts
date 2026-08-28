const AUTH_ERRORS = new Set(['not_a_member', 'member_id_required', 'member_id_invalid']);

interface WgLoadErrorOptions {
	verb?: 'konnte' | 'konnten';
}

export function getWgLoadErrorMessage(
	label: string,
	status: number,
	error: string | null,
	options: WgLoadErrorOptions = {},
): string {
	const prefix = `${label} ${options.verb ?? 'konnte'} nicht geladen werden`;
	if (status === 0 || error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return `${prefix}: Prüfe deine Verbindung und versuche es erneut.`;
	}
	if (status === 404 || error === 'wg_not_found') {
		return `${prefix}: Öffne die WG über den aktuellen Link erneut.`;
	}
	if (error === 'invalid_share_code') {
		return `${prefix}: Der WG-Code ist ungültig.`;
	}
	if (status === 401 || (error !== null && AUTH_ERRORS.has(error))) {
		return `${prefix}: Tritt der WG erneut bei.`;
	}
	if (error === 'query_invalid') {
		return `${prefix}: Der Suchbegriff ist zu lang.`;
	}
	if (error === 'server_error' || error === 'db_error' || status >= 500) {
		return `${prefix}: Versuche es gleich erneut.`;
	}
	return `${prefix}.`;
}
