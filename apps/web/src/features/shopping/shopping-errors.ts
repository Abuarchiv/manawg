import {
	isNetworkError,
	isRetryableServerError,
	mutationErrorMessage,
} from '@/core/http/error-codes';

const ADD_SUBJECT = 'Artikel konnte nicht gespeichert werden';
const ADD_ERRORS: Record<string, string> = {
	name_invalid: `${ADD_SUBJECT}: Der Name muss 1 bis 120 Zeichen haben.`,
	quantity_invalid: `${ADD_SUBJECT}: Die Menge darf höchstens 40 sein.`,
	bought_invalid: `${ADD_SUBJECT}: Der Status ist ungültig.`,
	invalid_json: `${ADD_SUBJECT}: Die Anfrage war ungültig.`,
	invalid_body: `${ADD_SUBJECT}: Die Anfrage war ungültig.`,
	shopping_item_duplicate:
		'Dieser Artikel steht bereits offen auf der Einkaufsliste. Prüfe den vorhandenen Eintrag; seine Menge bleibt unverändert.',
	insert_failed: `${ADD_SUBJECT}: Prüfe die Einkaufsliste und versuche es erneut.`,
};

export function shoppingAddErrorMessage(error: string): string {
	return mutationErrorMessage(
		ADD_SUBJECT,
		error,
		ADD_ERRORS,
		'Hinzufügen fehlgeschlagen. Versuche es gleich erneut.',
	);
}

const ACTION_SUBJECT = 'Einkaufsaktion konnte nicht gespeichert werden';
const ACTION_ERRORS: Record<string, string> = {
	invalid_body: `${ACTION_SUBJECT}: Die Anfrage war ungültig.`,
	invalid_json: `${ACTION_SUBJECT}: Die Anfrage war ungültig.`,
	bought_invalid: `${ACTION_SUBJECT}: Der Status ist ungültig.`,
	id_invalid: 'Dieser Einkaufsartikel kann nicht mehr eindeutig zugeordnet werden.',
};

export function shoppingActionErrorMessage(error: string, fallback: string): string {
	return mutationErrorMessage(ACTION_SUBJECT, error, ACTION_ERRORS, fallback);
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
