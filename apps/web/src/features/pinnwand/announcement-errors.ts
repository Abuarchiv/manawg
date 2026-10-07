import { mutationErrorMessage } from '@/core/http/error-codes';

const CREATE_SUBJECT = 'Beitrag konnte nicht gespeichert werden';
const CREATE_ERRORS: Record<string, string> = {
	content_invalid: `${CREATE_SUBJECT}: Der Text muss 1 bis 2000 Zeichen haben.`,
	kind_invalid: `${CREATE_SUBJECT}: Die Beitragsart ist ungültig.`,
	image_invalid: `${CREATE_SUBJECT}: Der Anhang ist ungültig.`,
	image_removed: `${CREATE_SUBJECT}: Der Anhang wurde entfernt. Lade das Bild erneut hoch.`,
	source_path_invalid: `${CREATE_SUBJECT}: Der Quelllink ist ungültig.`,
	insert_failed: `${CREATE_SUBJECT}: Prüfe die Pinnwand und versuche es erneut.`,
	invalid_json: `${CREATE_SUBJECT}: Die Anfrage war ungültig.`,
};

export function announcementCreateErrorMessage(error: string): string {
	return mutationErrorMessage(CREATE_SUBJECT, error, CREATE_ERRORS, `${CREATE_SUBJECT}.`);
}

const COMMENT_SUBJECT = 'Kommentar konnte nicht gespeichert werden';
const COMMENT_ERRORS: Record<string, string> = {
	comment_invalid: `${COMMENT_SUBJECT}: Der Text muss 1 bis 600 Zeichen haben.`,
	not_owner: 'Nur wer den Kommentar geschrieben hat, kann ihn ändern.',
	insert_failed: `${COMMENT_SUBJECT}: Lade den Beitrag neu und versuche es erneut.`,
	delete_failed:
		'Kommentar konnte nicht gelöscht werden: Lade den Beitrag neu und prüfe, ob er noch existiert.',
	comment_not_found:
		'Kommentar existiert nicht mehr. Lade den Beitrag neu, um den aktuellen Stand zu sehen.',
	invalid_json: `${COMMENT_SUBJECT}: Die Anfrage war ungültig.`,
};

export function commentActionErrorMessage(error: string): string {
	return mutationErrorMessage(
		COMMENT_SUBJECT,
		error,
		COMMENT_ERRORS,
		'Kommentar-Aktion fehlgeschlagen.',
		'Kommentar-Aktion fehlgeschlagen',
	);
}

const ACTION_SUBJECT = 'Aktion konnte nicht gespeichert werden';
const ACTION_ERRORS: Record<string, string> = {
	reaction_invalid: 'Reaktion konnte nicht gespeichert werden: Die Reaktion ist ungültig.',
	insert_failed:
		'Reaktion konnte nicht gespeichert werden: Lade den Beitrag neu und versuche es erneut.',
	delete_failed:
		'Reaktion konnte nicht entfernt werden: Lade den Beitrag neu und prüfe den aktuellen Stand.',
	reaction_not_found:
		'Reaktion existiert nicht mehr. Lade den Beitrag neu, um den aktuellen Stand zu sehen.',
	status_invalid: 'Pinnwand-Status konnte nicht gespeichert werden: Der Status ist ungültig.',
	pinned_invalid: 'Fixierung konnte nicht gespeichert werden: Der Wert ist ungültig.',
	kind_invalid: `${ACTION_SUBJECT}: Die Beitragsart ist ungültig.`,
	status_change_not_allowed:
		'Nur wer den Beitrag geschrieben hat oder ihn übernommen hat, kann diesen Beitrag als geklärt markieren.',
	invalid_body: `${ACTION_SUBJECT}: Die Anfrage war ungültig.`,
	invalid_json: `${ACTION_SUBJECT}: Die Anfrage war ungültig.`,
};

export function announcementActionErrorMessage(error: string): string {
	return mutationErrorMessage(
		ACTION_SUBJECT,
		error,
		ACTION_ERRORS,
		`${ACTION_SUBJECT}. Versuche es erneut.`,
	);
}
