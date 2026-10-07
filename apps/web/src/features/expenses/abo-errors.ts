const RETRYABLE_ERRORS = new Set(['unexpected_error', 'server_error', 'db_error']);
const MEMBERSHIP_ERRORS = new Set(['not_a_member', 'member_id_required', 'member_id_invalid']);
const NETWORK_ERRORS = new Set(['Netzwerkfehler', 'Failed to fetch']);
// Der Server lässt nur Ersteller oder WG-Admin Fixkosten ändern; die Buttons sehen alle.
const NOT_OWNER_HINT = 'Nur wer die Fixkosten angelegt hat oder Admin der WG ist, darf das.';

export function aboSaveErrorMessage(error: string, action: 'angelegt' | 'aktualisiert'): string {
	const prefix = `Fixkosten konnten nicht ${action} werden`;
	if (NETWORK_ERRORS.has(error)) {
		return `${prefix}: Prüfe deine Verbindung und versuche es erneut.`;
	}
	if (error === 'not_owner') return `${prefix}: ${NOT_OWNER_HINT}`;
	if (RETRYABLE_ERRORS.has(error)) {
		return `${prefix}: Versuche es gleich erneut.`;
	}
	if (error === 'wg_not_found') {
		return `${prefix}: Öffne die WG über den aktuellen Link erneut.`;
	}
	if (error === 'invalid_share_code') {
		return `${prefix}: Der WG-Code ist ungültig.`;
	}
	if (MEMBERSHIP_ERRORS.has(error)) {
		return `${prefix}: Tritt der WG erneut bei.`;
	}
	if (error === 'member_not_in_wg') {
		return `${prefix}: Mindestens ein Mitglied ist nicht mehr in dieser WG.`;
	}
	if (error === 'recurring_expense_not_found') {
		return 'Diese Fixkosten existieren nicht mehr. Lade die Liste neu.';
	}
	if (error === 'recurring_expense_changed') {
		return `${prefix}: Sie wurden inzwischen gebucht oder geändert. Die Liste ist neu geladen, bearbeite sie bitte noch einmal.`;
	}
	if (error === 'amount_invalid') {
		return `${prefix}: Prüfe den Betrag.`;
	}
	if (error === 'recurring_currency_unsupported') {
		return `${prefix}: Fixkosten werden derzeit nur in Euro unterstützt.`;
	}
	if (error === 'description_invalid') {
		return `${prefix}: Gib eine Beschreibung ein.`;
	}
	if (error === 'interval_invalid') {
		return `${prefix}: Wähle ein gültiges Intervall.`;
	}
	if (error === 'due_date_invalid') {
		return `${prefix}: Prüfe das nächste Fälligkeitsdatum.`;
	}
	if (error === 'splits_invalid' || error === 'splits_sum_mismatch') {
		return 'Beträge stimmen nicht überein — Summe muss exakt dem Gesamtbetrag entsprechen.';
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return `${prefix}: Die Anfrage war ungültig.`;
	}
	return `${prefix}.`;
}

export function aboActionErrorMessage(error: string): string {
	if (error === 'not_owner') return `Fixkosten-Aktion fehlgeschlagen: ${NOT_OWNER_HINT}`;
	if (NETWORK_ERRORS.has(error)) {
		return 'Fixkosten-Aktion fehlgeschlagen: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (RETRYABLE_ERRORS.has(error)) {
		return 'Fixkosten-Aktion fehlgeschlagen: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Fixkosten-Aktion fehlgeschlagen: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Fixkosten-Aktion fehlgeschlagen: Der WG-Code ist ungültig.';
	}
	if (MEMBERSHIP_ERRORS.has(error)) {
		return 'Fixkosten-Aktion fehlgeschlagen: Tritt der WG erneut bei.';
	}
	if (error === 'recurring_expense_not_found') {
		return 'Diese Fixkosten existieren nicht mehr. Lade die Liste neu.';
	}
	if (error === 'recurring_currency_unsupported') {
		return 'Fixkosten-Aktion fehlgeschlagen: Fixkosten werden derzeit nur in Euro unterstützt.';
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return 'Fixkosten-Aktion fehlgeschlagen: Die Anfrage war ungültig.';
	}
	return 'Fixkosten-Aktion fehlgeschlagen. Versuche es gleich erneut.';
}

export function aboDeleteErrorMessage(error: string): string {
	if (error === 'not_owner') return `Fixkosten konnten nicht gelöscht werden: ${NOT_OWNER_HINT}`;
	if (NETWORK_ERRORS.has(error)) {
		return 'Fixkosten konnten nicht gelöscht werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (RETRYABLE_ERRORS.has(error)) {
		return 'Fixkosten konnten nicht gelöscht werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Fixkosten konnten nicht gelöscht werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Fixkosten konnten nicht gelöscht werden: Der WG-Code ist ungültig.';
	}
	if (MEMBERSHIP_ERRORS.has(error)) {
		return 'Fixkosten konnten nicht gelöscht werden: Tritt der WG erneut bei.';
	}
	if (error === 'id_invalid') {
		return 'Fixkosten konnten nicht gelöscht werden: Der Eintrag konnte nicht eindeutig zugeordnet werden.';
	}
	if (error === 'recurring_expense_not_found') {
		return 'Diese Fixkosten existieren nicht mehr. Lade die Liste neu.';
	}
	if (error === 'delete_failed') {
		return 'Fixkosten konnten nicht gelöscht werden: Lade die Liste neu und prüfe, ob der Eintrag noch existiert.';
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return 'Fixkosten konnten nicht gelöscht werden: Die Anfrage war ungültig.';
	}
	return 'Fixkosten konnten nicht gelöscht werden.';
}
