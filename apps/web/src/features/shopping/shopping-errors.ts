import {
	isAuthInvalidated,
	isInvalidShareCode,
	isNetworkError,
	isRetryableServerError,
} from '@/core/errors/generic-error-codes';

export function shoppingAddErrorMessage(error: string): string {
	if (isNetworkError(error)) {
		return 'Artikel konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (isRetryableServerError(error)) {
		return 'Artikel konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Artikel konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (isInvalidShareCode(error)) {
		return 'Artikel konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (isAuthInvalidated(error)) {
		return 'Artikel konnte nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (error === 'name_invalid') {
		return 'Artikel konnte nicht gespeichert werden: Der Name muss 1 bis 120 Zeichen haben.';
	}
	if (error === 'quantity_invalid') {
		return 'Artikel konnte nicht gespeichert werden: Die Menge darf höchstens 40 sein.';
	}
	if (error === 'bought_invalid') {
		return 'Artikel konnte nicht gespeichert werden: Der Status ist ungültig.';
	}
	if (error === 'invalid_json' || error === 'invalid_body') {
		return 'Artikel konnte nicht gespeichert werden: Die Anfrage war ungültig.';
	}
	if (error === 'shopping_item_duplicate') {
		return 'Dieser Artikel steht bereits offen auf der Einkaufsliste. Prüfe den vorhandenen Eintrag; seine Menge bleibt unverändert.';
	}
	if (error === 'insert_failed') {
		return 'Artikel konnte nicht gespeichert werden: Prüfe die Einkaufsliste und versuche es erneut.';
	}
	return 'Hinzufügen fehlgeschlagen. Versuche es gleich erneut.';
}

export function shoppingActionErrorMessage(error: string, fallback: string): string {
	if (isNetworkError(error)) {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (isRetryableServerError(error)) {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (isInvalidShareCode(error)) {
		return 'Einkaufsaktion konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (isAuthInvalidated(error)) {
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
	if (status === 403 || error === 'not_admin') {
		return 'Nur Admins dürfen erledigte Artikel für die ganze WG entfernen.';
	}
	if (isNetworkError(error, status)) {
		return 'Erledigte konnten nicht entfernt werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (isRetryableServerError(error, status)) {
		return 'Erledigte konnten nicht entfernt werden: Versuche es gleich erneut.';
	}
	return 'Erledigte konnten nicht entfernt werden.';
}
