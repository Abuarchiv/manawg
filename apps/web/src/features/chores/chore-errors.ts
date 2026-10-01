import { isNetworkError, mutationErrorMessage } from '@/core/http/error-codes';

const ABSENCE_SUBJECT = 'Abwesenheit konnte nicht gespeichert werden';
const ABSENCE_ERRORS: Record<string, string> = {
	date_range_invalid: `${ABSENCE_SUBJECT}: Das Enddatum liegt vor dem Startdatum.`,
	reason_invalid: `${ABSENCE_SUBJECT}: Der Grund darf höchstens 120 Zeichen haben.`,
	member_not_in_wg: `${ABSENCE_SUBJECT}: Dieses Mitglied ist nicht mehr in dieser WG.`,
	absence_overlaps_existing: `${ABSENCE_SUBJECT}: In diesem Zeitraum ist für dieses Mitglied bereits eine Abwesenheit eingetragen.`,
	insert_failed: `${ABSENCE_SUBJECT}: Prüfe den Putzplan und versuche es erneut.`,
	invalid_json: `${ABSENCE_SUBJECT}: Die Anfrage war ungültig.`,
	invalid_body: `${ABSENCE_SUBJECT}: Die Anfrage war ungültig.`,
};

export function absenceSaveErrorMessage(error: string): string {
	return mutationErrorMessage(ABSENCE_SUBJECT, error, ABSENCE_ERRORS, `${ABSENCE_SUBJECT}.`);
}

const CHORE_SUBJECT = 'Putzaufgabe konnte nicht gespeichert werden';
const CHORE_CREATE_ERRORS: Record<string, string> = {
	member_not_in_wg: `${CHORE_SUBJECT}: Dieses Mitglied ist nicht mehr in dieser WG.`,
	interval_invalid: `${CHORE_SUBJECT}: Das Intervall muss zwischen 1 und 365 Tagen liegen.`,
	title_invalid: `${CHORE_SUBJECT}: Der Titel muss 1 bis 120 Zeichen haben.`,
	due_date_invalid: `${CHORE_SUBJECT}: Das Fälligkeitsdatum ist ungültig.`,
	insert_failed: `${CHORE_SUBJECT}: Prüfe den Putzplan und versuche es erneut.`,
	invalid_body: `${CHORE_SUBJECT}: Die Anfrage war ungültig.`,
	invalid_json: `${CHORE_SUBJECT}: Die Anfrage war ungültig.`,
};

export function choreCreateErrorMessage(error: string): string {
	return mutationErrorMessage(
		CHORE_SUBJECT,
		error,
		CHORE_CREATE_ERRORS,
		'Hinzufügen fehlgeschlagen. Versuche es gleich erneut.',
	);
}

/** Gemeinsame Fehlertexte für Tausch- und Übernahme-Aktion: `prefix` ist der Satz ohne Punkt. */
export function choreActionErrorMessage(
	prefix: string,
	result: { error: string; status: number },
): string {
	if (result.error === 'unexpected_error' || result.error === 'server_error') {
		return `${prefix}: Versuche es gleich erneut.`;
	}
	if (isNetworkError(result.error, result.status)) {
		return `${prefix}: Prüfe deine Verbindung und versuche es erneut.`;
	}
	return `${prefix}.`;
}
