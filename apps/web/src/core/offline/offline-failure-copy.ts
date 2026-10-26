import { isRateLimited } from '@/core/http/error-codes';

/**
 * German copy for why a queued offline action could not be sent, shown in the
 * offline banner and the settings queue. Specific server error codes win over
 * the generic status buckets; the order of the checks in
 * {@link explainOfflineActionFailure} is part of the contract.
 */

export interface OfflineFailureExplanation {
	title: string;
	detail: string;
}

/** Also tells a fresh connection failure apart from a server answer. */
export const OFFLINE_NO_CONNECTION_TITLE = 'Noch keine Verbindung';

/**
 * Prefixes of `lastError` texts that mark an action as held for manual review.
 * Persisted queue entries carry them, so the replay rules match on them.
 */
export const SERVER_CHECK_PREFIX = 'Server prüfen:';
export const IMAGE_MISSING_PREFIX = 'Bild fehlt:';
export const IMAGE_REMOVED_PREFIX = 'Bild wurde entfernt:';

export const IMAGE_REMOVED_ERROR = `${IMAGE_REMOVED_PREFIX} Entferne den Anhang in der Offline-Warteschlange oder wähle das Bild erneut aus.`;

const NO_CONNECTION: OfflineFailureExplanation = {
	title: OFFLINE_NO_CONNECTION_TITLE,
	detail: 'Die Aktion bleibt gespeichert und wird erneut versucht, sobald das Netz zurück ist.',
};

const RATE_LIMITED: OfflineFailureExplanation = {
	title: 'Zu viele Anfragen',
	detail: 'Die Aktion bleibt in der Warteschlange und wird gleich automatisch erneut gesendet.',
};

const TOO_LARGE: OfflineFailureExplanation = {
	title: 'Bild oder Eintrag ist zu groß',
	detail: 'Entferne den Anhang oder wähle ein kleineres Bild und versuche es erneut.',
};

const ACCESS_MISSING: OfflineFailureExplanation = {
	title: 'Zugriff fehlt',
	detail: 'Öffne die WG erneut oder prüfe, ob dein Mitglied noch Zugriff hat.',
};

const SESSION_EXPIRED: OfflineFailureExplanation = {
	title: 'Sitzung abgelaufen',
	detail: 'Melde dich neu an und versuche die Aktion danach erneut.',
};

const TARGET_GONE: OfflineFailureExplanation = {
	title: 'Ziel nicht mehr gefunden',
	detail:
		'Der Eintrag oder die WG wurde inzwischen geändert. Prüfe die Aktion vor dem erneuten Versuch.',
};

const SERVER_NOT_READY: OfflineFailureExplanation = {
	title: 'Server gerade nicht bereit',
	detail: 'Die Aktion bleibt in der Warteschlange. Versuche es gleich erneut.',
};

const SYNC_FAILED: OfflineFailureExplanation = {
	title: 'Synchronisierung fehlgeschlagen',
	detail: 'Die Aktion bleibt in der Warteschlange. Versuche es später noch einmal.',
};

/** Server error codes with their own explanation; several codes share one. */
const FAILURE_BY_CODE: Readonly<Record<string, OfflineFailureExplanation>> = {
	migration_read_only: {
		title: 'App in Wartung',
		detail:
			'Die Aktion bleibt in der Warteschlange und wird gesendet, sobald die Wartung vorbei ist.',
	},
	...withCodes(['not_a_member'], {
		title: 'Mitglied nicht mehr gültig',
		detail:
			'Öffne die WG erneut oder tritt mit einem aktuellen Einladungslink bei, bevor du diese Aktion sendest.',
	}),
	member_deactivated: {
		title: 'Du bist ausgezogen',
		detail:
			'Dein Mitglied ist in dieser WG als ausgezogen markiert. Neu anmelden hilft nicht. Frag die WG, ob sie dich wieder aufnimmt, bevor du diese Aktion sendest.',
	},
	member_not_in_wg: {
		title: 'Mitglied in Aktion prüfen',
		detail:
			'Ein beteiligtes Mitglied ist nicht mehr in der WG. Bearbeite Zuweisung oder Aufteilung vor dem erneuten Senden.',
	},
	...withCodes(['wg_not_found', 'invalid_share_code'], {
		title: 'WG-Link nicht mehr gültig',
		detail:
			'Prüfe den Einladungslink oder lass dir einen neuen Einladungslink geben, bevor du diese Aktion sendest.',
	}),
	recurring_expense_not_found: {
		title: 'Fixkosten-Vorlage fehlt',
		detail:
			'Die Vorlage existiert nicht mehr. Entferne diese Offline-Aktion oder erstelle die Fixkosten neu.',
	},
	abo_paused: {
		title: 'Fixkosten pausiert',
		detail:
			'Die Fixkosten sind inzwischen pausiert. Entferne diese Offline-Aktion oder setze die Fixkosten fort.',
	},
	item_not_found: {
		title: 'Einkauf fehlt',
		detail:
			'Der Artikel existiert nicht mehr. Entferne diese Offline-Aktion oder lege den Einkauf neu an.',
	},
	shopping_item_changed: {
		title: 'Einkaufsstatus geändert',
		detail:
			'Jemand hat den Artikel inzwischen geändert. Prüfe den aktuellen Stand, bevor du die Aktion neu anlegst.',
	},
	chore_occurrence_changed: {
		title: 'Putztermin geändert',
		detail:
			'Der Termin wurde inzwischen erledigt oder neu zugewiesen. Prüfe den aktuellen Plan, bevor du die Aktion neu anlegst.',
	},
	chore_not_found: {
		title: 'Putzplan-Aufgabe fehlt',
		detail:
			'Die Aufgabe existiert nicht mehr. Entferne diese Offline-Aktion oder lege die Aufgabe neu an.',
	},
	expense_not_found: {
		title: 'Ausgabe fehlt',
		detail:
			'Die Ausgabe existiert nicht mehr. Entferne diese Offline-Aktion oder erfasse die Ausgabe neu.',
	},
	split_not_found: {
		title: 'Ausgabenanteil fehlt',
		detail:
			'Der Anteil existiert nicht mehr. Entferne diese Offline-Aktion oder prüfe die Ausgabe erneut.',
	},
	image_invalid: {
		title: 'Anhang prüfen',
		detail: 'Entferne den Anhang oder wähle ein gültiges Bild, bevor du erneut sendest.',
	},
	amount_invalid: {
		title: 'Betrag prüfen',
		detail: 'Bearbeite Betrag und Aufteilung, bevor du diese Aktion erneut sendest.',
	},
	currency_invalid: {
		title: 'Währung prüfen',
		detail: 'Erfasse die Ausgabe neu mit der aktuellen Euro-Währung.',
	},
	...withCodes(['splits_sum_mismatch', 'splits_invalid'], {
		title: 'Aufteilung prüfen',
		detail: 'Bearbeite Betrag und Aufteilung, bevor du diese Aktion erneut sendest.',
	}),
	...withCodes(['name_invalid', 'content_invalid', 'title_invalid', 'description_invalid'], {
		title: 'Eintrag prüfen',
		detail: 'Bearbeite die markierten Felder, bevor du diese Aktion erneut sendest.',
	}),
	kind_invalid: {
		title: 'Kategorie prüfen',
		detail: 'Wähle eine aktuelle Pinnwand-Kategorie, bevor du den Beitrag erneut sendest.',
	},
	source_path_invalid: {
		title: 'Quelllink prüfen',
		detail: 'Entferne den alten Quelllink oder erfasse den Pinnwand-Beitrag neu.',
	},
	quantity_invalid: {
		title: 'Menge prüfen',
		detail: 'Kürze oder entferne die Mengenangabe, bevor du diesen Einkauf erneut sendest.',
	},
	...withCodes(['due_date_invalid', 'occurred_at_invalid', 'date_range_invalid'], {
		title: 'Datum prüfen',
		detail: 'Bearbeite Datum oder Zeitraum, bevor du diese Aktion erneut sendest.',
	}),
	absence_overlaps_existing: {
		title: 'Abwesenheit überschneidet sich',
		detail:
			'Für diese Person gibt es im Zeitraum schon eine Abwesenheit. Entferne diese Offline-Aktion oder passe den Zeitraum an.',
	},
	invalid_body: {
		title: 'Offline-Aktion prüfen',
		detail:
			'Die gespeicherte Aktion passt nicht mehr zur aktuellen App. Entferne sie und erfasse den Eintrag neu.',
	},
	id_invalid: {
		title: 'Ziel prüfen',
		detail:
			'Die gespeicherte Ziel-ID ist ungültig. Entferne diese Offline-Aktion und öffne den Eintrag neu.',
	},
	bought_invalid: {
		title: 'Status prüfen',
		detail: 'Prüfe den Einkaufsstatus, bevor du diese Aktion erneut sendest.',
	},
	interval_invalid: {
		title: 'Intervall prüfen',
		detail: 'Bearbeite das Intervall, bevor du diese Aktion erneut sendest.',
	},
	reason_invalid: {
		title: 'Grund prüfen',
		detail: 'Kürze oder entferne den Abwesenheitsgrund, bevor du diese Aktion erneut sendest.',
	},
	completion_insert_failed: {
		title: 'Putzplan unvollständig gespeichert',
		detail:
			'Die Aufgabe wurde möglicherweise rotiert, aber nicht im Verlauf protokolliert. Lade den Putzplan neu und prüfe den Verlauf vor dem erneuten Senden.',
	},
	split_insert_failed: {
		title: 'Ausgabe unvollständig gespeichert',
		detail:
			'Die Ausgabe oder ihre Aufteilung wurde nicht vollständig gespeichert. Lade die Ausgaben neu und prüfe den Eintrag vor dem erneuten Senden.',
	},
	insert_failed: {
		title: 'Speichern nicht bestätigt',
		detail:
			'Der Server hat den Eintrag nicht bestätigt. Lade die WG neu und prüfe, ob die Aktion bereits angekommen ist.',
	},
	delete_failed: {
		title: 'Entfernen nicht bestätigt',
		detail:
			'Der Server hat das Entfernen nicht bestätigt. Lade die WG neu und prüfe den Eintrag vor dem erneuten Senden.',
	},
	update_failed: {
		title: 'Aktualisierung nicht bestätigt',
		detail:
			'Der Server hat die Änderung nicht bestätigt. Lade die WG neu und prüfe den aktuellen Stand vor dem erneuten Senden.',
	},
};

const SERVER_ERROR_CODES = new Set(['server_error', 'db_error', 'unexpected_error']);

function withCodes(
	codes: readonly string[],
	explanation: OfflineFailureExplanation,
): Record<string, OfflineFailureExplanation> {
	return Object.fromEntries(codes.map((code) => [code, explanation]));
}

export function explainOfflineActionFailure(
	status: number,
	error?: string,
): OfflineFailureExplanation {
	const code = error ?? null;
	if (status === 0) return { ...NO_CONNECTION };
	// Covers 429 and every `*_rate_limited` code: the queue retries these by itself.
	if (isRateLimited(code, status)) return { ...RATE_LIMITED };
	const known =
		code !== null && Object.hasOwn(FAILURE_BY_CODE, code) ? FAILURE_BY_CODE[code] : null;
	if (known) return { ...known };
	if (status === 413) return { ...TOO_LARGE };
	if (status === 401) return { ...SESSION_EXPIRED };
	if (status === 403) return { ...ACCESS_MISSING };
	if (status === 404) return { ...TARGET_GONE };
	if (status >= 500 || (code !== null && SERVER_ERROR_CODES.has(code))) {
		return { ...SERVER_NOT_READY };
	}
	return { ...SYNC_FAILED };
}
