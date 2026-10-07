import {
	isNetworkError,
	isRetryableServerError,
	mutationErrorMessage,
} from '@/core/http/error-codes';

const ADD_SUBJECT = 'Artikel konnte nicht gespeichert werden';
const ADD_ERRORS: Record<string, string> = {
	name_invalid: `${ADD_SUBJECT}: Der Name muss 1 bis 120 Zeichen haben.`,
	quantity_invalid: `${ADD_SUBJECT}: Die Menge darf höchstens 40 Zeichen haben.`,
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

export type ShoppingActionVerb = 'abgehakt' | 'wieder geöffnet' | 'entfernt';

/** Nennt Artikel und Aktion, damit der Text nicht wie ein Fehler beim Hinzufügen wirkt. */
export function shoppingActionErrorMessage(
	error: string,
	itemName: string,
	verb: ShoppingActionVerb,
): string {
	const subject = `„${itemName}“ konnte nicht ${verb} werden`;
	return mutationErrorMessage(
		subject,
		error,
		{
			invalid_body: `${subject}: Die Anfrage war ungültig.`,
			invalid_json: `${subject}: Die Anfrage war ungültig.`,
			bought_invalid: `${subject}: Der Status ist ungültig.`,
			id_invalid: 'Dieser Einkaufsartikel kann nicht mehr eindeutig zugeordnet werden.',
		},
		`${subject}. Versuche es gleich erneut.`,
	);
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
