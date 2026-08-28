export function shoppingAddErrorMessage(error: string): string {
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Artikel konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (error === 'unexpected_error' || error === 'server_error' || error === 'db_error') {
		return 'Artikel konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Artikel konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Artikel konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (error === 'not_a_member' || error === 'member_id_required' || error === 'member_id_invalid') {
		return 'Artikel konnte nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (error === 'name_invalid') {
		return 'Artikel konnte nicht gespeichert werden: Der Name muss 1 bis 120 Zeichen haben.';
	}
	if (error === 'quantity_invalid') {
		return 'Artikel konnte nicht gespeichert werden: Die Menge darf höchstens 40 Zeichen haben.';
	}
	if (error === 'bought_invalid') {
		return 'Artikel konnte nicht gespeichert werden: Der Status ist ungültig.';
	}
	if (error === 'invalid_json' || error === 'invalid_body') {
		return 'Artikel konnte nicht gespeichert werden: Die Anfrage war ungültig.';
	}
	if (error === 'insert_failed') {
		return 'Artikel konnte nicht gespeichert werden: Prüfe die Einkaufsliste und versuche es erneut.';
	}
	return 'Hinzufügen fehlgeschlagen.';
}

export function shoppingActionErrorMessage(error: string, fallback: string): string {
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (error === 'unexpected_error' || error === 'server_error' || error === 'db_error') {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (error === 'not_a_member' || error === 'member_id_required' || error === 'member_id_invalid') {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Die Anfrage war ungültig.';
	}
	if (error === 'bought_invalid') {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Der Status ist ungültig.';
	}
	if (error === 'id_invalid') {
		return 'Dieser Einkaufsartikel kann nicht mehr eindeutig zugeordnet werden.';
	}
	return fallback;
}

export function clearBoughtErrorMessage(status: number, error: string): string {
	if (status === 0 || error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Erledigte konnten nicht entfernt werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (error === 'unexpected_error' || error === 'server_error' || error === 'db_error') {
		return 'Erledigte konnten nicht entfernt werden: Versuche es gleich erneut.';
	}
	return 'Erledigte konnten nicht entfernt werden.';
}
