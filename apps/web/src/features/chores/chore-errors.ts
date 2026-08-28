export function absenceSaveErrorMessage(error: string): string {
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Abwesenheit konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (error === 'unexpected_error' || error === 'server_error' || error === 'db_error') {
		return 'Abwesenheit konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Abwesenheit konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Abwesenheit konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (error === 'not_a_member' || error === 'member_id_required' || error === 'member_id_invalid') {
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
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (error === 'unexpected_error' || error === 'server_error' || error === 'db_error') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Putzaufgabe konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (error === 'not_a_member' || error === 'member_id_required' || error === 'member_id_invalid') {
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
	return 'Hinzufügen fehlgeschlagen.';
}
