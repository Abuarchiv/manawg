import { mutationErrorMessage } from '@/core/http/error-codes';
import { SPLIT_SUM_MISMATCH } from '@/features/expenses/expense-errors';

// The server lets only the creator or a WG admin change recurring expenses; everyone sees the buttons.
const NOT_OWNER_HINT = 'Nur wer die Fixkosten angelegt hat oder Admin der WG ist, darf das.';
const GONE = 'Diese Fixkosten existieren nicht mehr. Lade die Liste neu.';
const EURO_ONLY = 'Fixkosten werden derzeit nur in Euro unterstützt.';
const INVALID_REQUEST = 'Die Anfrage war ungültig.';

/** Codes every recurring-expense call can answer with; the shared buckets (offline, 429, 503, 401) come from `mutationErrorMessage`. */
function commonTexts(prefix: string): Record<string, string> {
	return {
		not_owner: `${prefix}: ${NOT_OWNER_HINT}`,
		recurring_expense_not_found: GONE,
		recurring_currency_unsupported: `${prefix}: ${EURO_ONLY}`,
		invalid_body: `${prefix}: ${INVALID_REQUEST}`,
		invalid_json: `${prefix}: ${INVALID_REQUEST}`,
	};
}

export function aboSaveErrorMessage(error: string, action: 'angelegt' | 'aktualisiert'): string {
	const prefix = `Fixkosten konnten nicht ${action} werden`;
	return mutationErrorMessage(
		prefix,
		error,
		{
			...commonTexts(prefix),
			member_not_in_wg: `${prefix}: Mindestens ein Mitglied ist nicht mehr in dieser WG.`,
			recurring_expense_changed: `${prefix}: Diese Fixkosten wurden inzwischen gebucht oder geändert. Die Liste ist neu geladen, bearbeite sie noch einmal.`,
			amount_invalid: `${prefix}: Prüfe den Betrag.`,
			description_invalid: `${prefix}: Gib eine Beschreibung ein.`,
			interval_invalid: `${prefix}: Wähle ein gültiges Intervall.`,
			due_date_invalid: `${prefix}: Prüfe das nächste Fälligkeitsdatum.`,
			splits_invalid: SPLIT_SUM_MISMATCH,
			splits_sum_mismatch: SPLIT_SUM_MISMATCH,
		},
		`${prefix}.`,
	);
}

export function aboActionErrorMessage(error: string): string {
	const prefix = 'Fixkosten-Aktion fehlgeschlagen';
	return mutationErrorMessage(
		prefix,
		error,
		commonTexts(prefix),
		`${prefix}. Versuche es gleich erneut.`,
	);
}

export function aboDeleteErrorMessage(error: string): string {
	const prefix = 'Fixkosten konnten nicht gelöscht werden';
	return mutationErrorMessage(
		prefix,
		error,
		{
			...commonTexts(prefix),
			id_invalid: `${prefix}: Der Eintrag konnte nicht eindeutig zugeordnet werden.`,
			delete_failed: `${prefix}: Lade die Liste neu und prüfe, ob der Eintrag noch existiert.`,
		},
		`${prefix}.`,
	);
}
