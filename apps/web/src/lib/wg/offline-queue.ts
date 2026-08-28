import { parseTimestamp } from '@/lib/time';

export type OfflineActionType =
	| 'shopping.create'
	| 'shopping.update'
	| 'announcement.create'
	| 'absence.create'
	| 'chore.create'
	| 'chore.complete'
	| 'expense.create'
	| 'recurring.create'
	| 'recurring.advance';

export interface OfflineAction {
	id: string;
	type: OfflineActionType;
	shareCode: string;
	memberId: string;
	createdAt: string;
	payload: Record<string, unknown>;
	attempts?: number;
	lastAttemptAt?: string;
	lastError?: string;
}

interface OfflineActionRequest {
	path: string;
	method: 'POST' | 'PATCH';
	body: Record<string, unknown>;
}

interface OfflineActionSummary {
	title: string;
	detail: string;
}

interface OfflineFailureExplanation {
	title: string;
	detail: string;
}

interface OfflineActionRisk {
	title: string;
	detail: string;
}

interface QueuedShoppingInput {
	shareCode: string;
	memberId: string;
	name: string;
	quantity: string | null;
	now?: number;
}

interface QueuedShoppingUpdateInput {
	shareCode: string;
	memberId: string;
	itemId: string;
	name: string;
	bought: boolean;
	now?: number;
}

interface QueuedAnnouncementInput {
	shareCode: string;
	memberId: string;
	content: string;
	kind: string;
	imageUrl?: string | null;
	now?: number;
}

interface QueuedChoreCompletionInput {
	shareCode: string;
	memberId: string;
	choreId: string;
	now?: number;
}

interface QueuedChoreInput {
	shareCode: string;
	memberId: string;
	title: string;
	intervalDays: number;
	assignedMemberId: string | null;
	now?: number;
}

interface QueuedAbsenceInput {
	shareCode: string;
	memberId: string;
	absenceMemberId: string;
	startDate: string;
	endDate: string;
	reason: string | null;
	now?: number;
}

interface QueuedExpenseInput {
	shareCode: string;
	memberId: string;
	description: string;
	amountCents: number;
	paidByMemberId: string;
	splits: Array<{ debtorMemberId: string; amountCents: number }>;
	imageUrl?: string | null;
	recurringExpenseId?: string;
	expectedRecurringNextDueAt?: string;
	now?: number;
}

interface QueuedRecurringInput {
	shareCode: string;
	memberId: string;
	description: string;
	amountCents: number;
	paidByMemberId: string;
	intervalMonths: number;
	nextDueAt: string;
	splits: Array<{ debtorMemberId: string; amountCents: number }>;
	now?: number;
}

function slug(value: string): string {
	return (
		value
			.trim()
			.toLocaleLowerCase('de-DE')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'item'
	);
}

function pathSegment(value: unknown): string {
	return encodeURIComponent(String(value));
}

export function createQueuedShoppingItem(input: QueuedShoppingInput): OfflineAction {
	const now = input.now ?? Date.now();
	return {
		id: `shopping:${input.shareCode}:${now}:${slug(input.name)}`,
		type: 'shopping.create',
		shareCode: input.shareCode,
		memberId: input.memberId,
		createdAt: new Date(now).toISOString(),
		payload: {
			name: input.name,
			quantity: input.quantity,
		},
	};
}

export function createQueuedShoppingUpdate(input: QueuedShoppingUpdateInput): OfflineAction {
	const now = input.now ?? Date.now();
	return {
		id: `shopping-update:${input.shareCode}:${now}:${input.itemId}`,
		type: 'shopping.update',
		shareCode: input.shareCode,
		memberId: input.memberId,
		createdAt: new Date(now).toISOString(),
		payload: {
			itemId: input.itemId,
			name: input.name,
			bought: input.bought,
		},
	};
}

export function createQueuedAnnouncement(input: QueuedAnnouncementInput): OfflineAction {
	const now = input.now ?? Date.now();
	return {
		id: `announcement:${input.shareCode}:${now}:${slug(input.content)}`,
		type: 'announcement.create',
		shareCode: input.shareCode,
		memberId: input.memberId,
		createdAt: new Date(now).toISOString(),
		payload: {
			content: input.content,
			kind: input.kind,
			imageUrl: input.imageUrl ?? null,
		},
	};
}

export function createQueuedChoreCompletion(input: QueuedChoreCompletionInput): OfflineAction {
	const now = input.now ?? Date.now();
	return {
		id: `chore:${input.shareCode}:${now}:${input.choreId}`,
		type: 'chore.complete',
		shareCode: input.shareCode,
		memberId: input.memberId,
		createdAt: new Date(now).toISOString(),
		payload: {
			choreId: input.choreId,
		},
	};
}

export function createQueuedChore(input: QueuedChoreInput): OfflineAction {
	const now = input.now ?? Date.now();
	return {
		id: `chore-create:${input.shareCode}:${now}:${slug(input.title)}`,
		type: 'chore.create',
		shareCode: input.shareCode,
		memberId: input.memberId,
		createdAt: new Date(now).toISOString(),
		payload: {
			title: input.title,
			intervalDays: input.intervalDays,
			assignedMemberId: input.assignedMemberId,
		},
	};
}

export function createQueuedAbsence(input: QueuedAbsenceInput): OfflineAction {
	const now = input.now ?? Date.now();
	return {
		id: `absence:${input.shareCode}:${now}:${input.absenceMemberId}`,
		type: 'absence.create',
		shareCode: input.shareCode,
		memberId: input.memberId,
		createdAt: new Date(now).toISOString(),
		payload: {
			memberId: input.absenceMemberId,
			startDate: input.startDate,
			endDate: input.endDate,
			reason: input.reason,
		},
	};
}

export function createQueuedExpense(input: QueuedExpenseInput): OfflineAction {
	const now = input.now ?? Date.now();
	return {
		id: `expense:${input.shareCode}:${now}:${slug(input.description)}`,
		type: 'expense.create',
		shareCode: input.shareCode,
		memberId: input.memberId,
		createdAt: new Date(now).toISOString(),
		payload: {
			description: input.description,
			amountCents: input.amountCents,
			paidByMemberId: input.paidByMemberId,
			splits: input.splits,
			imageUrl: input.imageUrl ?? null,
			...(input.recurringExpenseId ? { recurringExpenseId: input.recurringExpenseId } : {}),
			...(input.expectedRecurringNextDueAt
				? { expectedRecurringNextDueAt: input.expectedRecurringNextDueAt }
				: {}),
		},
	};
}

export function createQueuedRecurring(input: QueuedRecurringInput): OfflineAction {
	const now = input.now ?? Date.now();
	return {
		id: `recurring:${input.shareCode}:${now}:${slug(input.description)}`,
		type: 'recurring.create',
		shareCode: input.shareCode,
		memberId: input.memberId,
		createdAt: new Date(now).toISOString(),
		payload: {
			description: input.description,
			amountCents: input.amountCents,
			paidByMemberId: input.paidByMemberId,
			intervalMonths: input.intervalMonths,
			nextDueAt: input.nextDueAt,
			splits: input.splits,
		},
	};
}

export function serializeOfflineAction(action: OfflineAction): string {
	return JSON.stringify(action);
}

export function getOfflineActionRequest(action: OfflineAction): OfflineActionRequest {
	const shareCode = pathSegment(action.shareCode);
	switch (action.type) {
		case 'shopping.create':
			return {
				path: `/api/wg/${shareCode}/shopping`,
				method: 'POST',
				body: { ...action.payload, addedByMemberId: action.memberId },
			};
		case 'shopping.update':
			return {
				path: `/api/wg/${shareCode}/shopping/${pathSegment(action.payload.itemId)}`,
				method: 'PATCH',
				body: { bought: action.payload.bought },
			};
		case 'announcement.create':
			return {
				path: `/api/wg/${shareCode}/announcements`,
				method: 'POST',
				body: Object.fromEntries(
					Object.entries(action.payload).filter(([, value]) => value !== null),
				),
			};
		case 'absence.create':
			return {
				path: `/api/wg/${shareCode}/absences`,
				method: 'POST',
				body: Object.fromEntries(
					Object.entries(action.payload).filter(([, value]) => value !== null),
				),
			};
		case 'chore.create':
			return {
				path: `/api/wg/${shareCode}/chores`,
				method: 'POST',
				body: action.payload,
			};
		case 'chore.complete':
			return {
				path: `/api/wg/${shareCode}/chores/${pathSegment(action.payload.choreId)}/complete`,
				method: 'POST',
				body: {},
			};
		case 'expense.create': {
			const {
				recurringExpenseId: _recurringExpenseId,
				expectedRecurringNextDueAt: _expectedRecurringNextDueAt,
				...expensePayload
			} = action.payload;
			return {
				path: `/api/wg/${shareCode}/expenses`,
				method: 'POST',
				body: Object.fromEntries(
					Object.entries(expensePayload).filter(([, value]) => value !== null),
				),
			};
		}
		case 'recurring.create':
			return {
				path: `/api/wg/${shareCode}/recurring-expenses`,
				method: 'POST',
				body: action.payload,
			};
		case 'recurring.advance':
			return {
				path: `/api/wg/${shareCode}/recurring-expenses`,
				method: 'PATCH',
				body: {
					id: action.payload.recurringExpenseId,
					...(typeof action.payload.expectedRecurringNextDueAt === 'string'
						? { expectedNextDueAt: action.payload.expectedRecurringNextDueAt }
						: {}),
				},
			};
	}
}

export function getOfflineActionSummary(action: OfflineAction): OfflineActionSummary {
	switch (action.type) {
		case 'shopping.create':
			return {
				title: 'Einkauf',
				detail: String(action.payload.name ?? 'Neuer Artikel'),
			};
		case 'shopping.update':
			return {
				title: 'Einkauf',
				detail: `${String(action.payload.name ?? 'Artikel')} ${
					action.payload.bought === true ? 'abhaken' : 'wieder öffnen'
				}`,
			};
		case 'announcement.create':
			return {
				title: 'Pinnwand-Beitrag',
				detail: String(action.payload.content ?? 'Neuer Beitrag'),
			};
		case 'absence.create':
			return {
				title: 'Abwesenheit',
				detail: 'Rotation überspringt diese Person',
			};
		case 'chore.create':
			return {
				title: 'Putzplan-Aufgabe',
				detail: String(action.payload.title ?? 'Neue Aufgabe'),
			};
		case 'chore.complete':
			return {
				title: 'Putzplan',
				detail: 'Aufgabe als erledigt markieren',
			};
		case 'expense.create':
			return {
				title: 'Ausgabe',
				detail: String(action.payload.description ?? 'Neue Ausgabe'),
			};
		case 'recurring.create':
			return {
				title: 'Fixkosten-Vorlage',
				detail: String(action.payload.description ?? 'Neue Vorlage'),
			};
		case 'recurring.advance':
			return {
				title: 'Fixkosten-Vorlage',
				detail: 'Fälligkeit nachholen',
			};
	}
}

export function explainOfflineActionFailure(
	status: number,
	error?: string,
): OfflineFailureExplanation {
	if (status === 0) {
		return {
			title: 'Noch keine Verbindung',
			detail: 'Die Aktion bleibt gespeichert und wird erneut versucht, sobald das Netz zurück ist.',
		};
	}
	if (error === 'not_a_member' || error === 'member_id_required' || error === 'member_id_invalid') {
		return {
			title: 'Mitglied nicht mehr gültig',
			detail:
				'Öffne die WG erneut oder tritt mit einem aktuellen Einladungslink bei, bevor du diese Aktion sendest.',
		};
	}
	if (error === 'member_not_in_wg') {
		return {
			title: 'Mitglied in Aktion prüfen',
			detail:
				'Ein beteiligtes Mitglied ist nicht mehr in der WG. Bearbeite Zuweisung oder Aufteilung vor dem erneuten Senden.',
		};
	}
	if (error === 'wg_not_found' || error === 'invalid_share_code') {
		return {
			title: 'WG-Link nicht mehr gültig',
			detail:
				'Prüfe den Einladungslink oder lass dir einen neuen Share-Code geben, bevor du diese Aktion sendest.',
		};
	}
	if (error === 'recurring_expense_not_found') {
		return {
			title: 'Fixkosten-Vorlage fehlt',
			detail:
				'Die Vorlage existiert nicht mehr. Entferne diese Offline-Aktion oder erstelle die Fixkosten neu.',
		};
	}
	if (error === 'item_not_found') {
		return {
			title: 'Einkauf fehlt',
			detail:
				'Der Artikel existiert nicht mehr. Entferne diese Offline-Aktion oder lege den Einkauf neu an.',
		};
	}
	if (error === 'chore_not_found') {
		return {
			title: 'Putzplan-Aufgabe fehlt',
			detail:
				'Die Aufgabe existiert nicht mehr. Entferne diese Offline-Aktion oder lege die Aufgabe neu an.',
		};
	}
	if (error === 'expense_not_found') {
		return {
			title: 'Ausgabe fehlt',
			detail:
				'Die Ausgabe existiert nicht mehr. Entferne diese Offline-Aktion oder erfasse die Ausgabe neu.',
		};
	}
	if (error === 'split_not_found') {
		return {
			title: 'Ausgabenanteil fehlt',
			detail:
				'Der Anteil existiert nicht mehr. Entferne diese Offline-Aktion oder prüfe die Ausgabe erneut.',
		};
	}
	if (status === 413) {
		return {
			title: 'Bild oder Eintrag ist zu groß',
			detail: 'Entferne den Anhang oder wähle ein kleineres Bild und versuche es erneut.',
		};
	}
	if (error === 'image_invalid') {
		return {
			title: 'Anhang prüfen',
			detail: 'Entferne den Anhang oder wähle ein gültiges Bild, bevor du erneut sendest.',
		};
	}
	if (error === 'amount_invalid') {
		return {
			title: 'Betrag prüfen',
			detail: 'Bearbeite Betrag und Aufteilung, bevor du diese Aktion erneut sendest.',
		};
	}
	if (error === 'currency_invalid') {
		return {
			title: 'Währung prüfen',
			detail: 'Erfasse die Ausgabe neu mit der aktuellen Euro-Währung.',
		};
	}
	if (error === 'splits_sum_mismatch' || error === 'splits_invalid') {
		return {
			title: 'Aufteilung prüfen',
			detail: 'Bearbeite Betrag und Aufteilung, bevor du diese Aktion erneut sendest.',
		};
	}
	if (
		error === 'name_invalid' ||
		error === 'content_invalid' ||
		error === 'title_invalid' ||
		error === 'description_invalid'
	) {
		return {
			title: 'Eintrag prüfen',
			detail: 'Bearbeite die markierten Felder, bevor du diese Aktion erneut sendest.',
		};
	}
	if (error === 'kind_invalid') {
		return {
			title: 'Kategorie prüfen',
			detail: 'Wähle eine aktuelle Pinnwand-Kategorie, bevor du den Beitrag erneut sendest.',
		};
	}
	if (error === 'source_path_invalid') {
		return {
			title: 'Quelllink prüfen',
			detail: 'Entferne den alten Quelllink oder erfasse den Pinnwand-Beitrag neu.',
		};
	}
	if (error === 'quantity_invalid') {
		return {
			title: 'Menge prüfen',
			detail: 'Kürze oder entferne die Mengenangabe, bevor du diesen Einkauf erneut sendest.',
		};
	}
	if (
		error === 'due_date_invalid' ||
		error === 'occurred_at_invalid' ||
		error === 'date_range_invalid'
	) {
		return {
			title: 'Datum prüfen',
			detail: 'Bearbeite Datum oder Zeitraum, bevor du diese Aktion erneut sendest.',
		};
	}
	if (error === 'invalid_body') {
		return {
			title: 'Offline-Aktion prüfen',
			detail:
				'Die gespeicherte Aktion passt nicht mehr zur aktuellen App. Entferne sie und erfasse den Eintrag neu.',
		};
	}
	if (error === 'id_invalid') {
		return {
			title: 'Ziel prüfen',
			detail:
				'Die gespeicherte Ziel-ID ist ungültig. Entferne diese Offline-Aktion und öffne den Eintrag neu.',
		};
	}
	if (error === 'bought_invalid') {
		return {
			title: 'Status prüfen',
			detail: 'Prüfe den Einkaufsstatus, bevor du diese Aktion erneut sendest.',
		};
	}
	if (error === 'interval_invalid') {
		return {
			title: 'Intervall prüfen',
			detail: 'Bearbeite das Intervall, bevor du diese Aktion erneut sendest.',
		};
	}
	if (error === 'reason_invalid') {
		return {
			title: 'Grund prüfen',
			detail: 'Kürze oder entferne den Abwesenheitsgrund, bevor du diese Aktion erneut sendest.',
		};
	}
	if (error === 'completion_insert_failed') {
		return {
			title: 'Putzplan unvollständig gespeichert',
			detail:
				'Die Aufgabe wurde möglicherweise rotiert, aber nicht im Verlauf protokolliert. Lade den Putzplan neu und prüfe den Verlauf vor dem erneuten Senden.',
		};
	}
	if (error === 'split_insert_failed') {
		return {
			title: 'Ausgabe unvollständig gespeichert',
			detail:
				'Die Ausgabe oder ihre Aufteilung wurde nicht vollständig gespeichert. Lade die Ausgaben neu und prüfe den Eintrag vor dem erneuten Senden.',
		};
	}
	if (error === 'insert_failed') {
		return {
			title: 'Speichern nicht bestätigt',
			detail:
				'Der Server hat den Eintrag nicht bestätigt. Lade die WG neu und prüfe, ob die Aktion bereits angekommen ist.',
		};
	}
	if (error === 'delete_failed') {
		return {
			title: 'Entfernen nicht bestätigt',
			detail:
				'Der Server hat das Entfernen nicht bestätigt. Lade die WG neu und prüfe den Eintrag vor dem erneuten Senden.',
		};
	}
	if (error === 'update_failed') {
		return {
			title: 'Aktualisierung nicht bestätigt',
			detail:
				'Der Server hat die Änderung nicht bestätigt. Lade die WG neu und prüfe den aktuellen Stand vor dem erneuten Senden.',
		};
	}
	if (status === 401 || status === 403) {
		return {
			title: 'Zugriff fehlt',
			detail: 'Öffne die WG erneut oder prüfe, ob dein Mitglied noch Zugriff hat.',
		};
	}
	if (status === 404) {
		return {
			title: 'Ziel nicht mehr gefunden',
			detail:
				'Der Eintrag oder die WG wurde inzwischen geändert. Prüfe die Aktion vor dem erneuten Versuch.',
		};
	}
	if (
		status >= 500 ||
		error === 'server_error' ||
		error === 'db_error' ||
		error === 'unexpected_error'
	) {
		return {
			title: 'Server gerade nicht bereit',
			detail: 'Die Aktion bleibt in der Warteschlange. Versuche es gleich erneut.',
		};
	}
	return {
		title: 'Synchronisierung fehlgeschlagen',
		detail: 'Die Aktion bleibt in der Warteschlange. Versuche es später noch einmal.',
	};
}

export function getOfflineRetryDelayMs(action: OfflineAction): number {
	const attempts = action.attempts ?? 0;
	if (attempts <= 0) return 0;
	return Math.min(15 * 60_000, 15_000 * 2 ** attempts);
}

export function shouldRetryOfflineAction(action: OfflineAction, now = Date.now()): boolean {
	if (!action.lastAttemptAt) return true;
	const lastAttempt = parseTimestamp(action.lastAttemptAt);
	if (lastAttempt === null) return true;
	// A lastAttempt far in the future means the device clock has been
	// corrected backwards — treat it as "now" instead of blocking retries
	// until the clock catches up.
	const effectiveLastAttempt = Math.min(lastAttempt, now);
	return now - effectiveLastAttempt >= getOfflineRetryDelayMs(action);
}

export function getOfflineActionRisk(
	action: OfflineAction,
	now = Date.now(),
): OfflineActionRisk | null {
	const createdAt = parseTimestamp(action.createdAt);
	if (createdAt === null) {
		return {
			title: 'Zeitpunkt prüfen',
			detail: 'Der gespeicherte Zeitpunkt ist unklar. Prüfe den Eintrag vor dem erneuten Senden.',
		};
	}
	if (createdAt > now) {
		return {
			title: 'Zeitpunkt prüfen',
			detail: 'Der gespeicherte Zeitpunkt liegt in der Zukunft. Prüfe den Eintrag vor dem Senden.',
		};
	}
	const ageHours = Math.floor((now - createdAt) / 3_600_000);
	if (ageHours < 6 && !action.lastError) return null;
	if (action.type === 'chore.complete') {
		return {
			title: 'Möglicher Konflikt',
			detail: 'Prüfe kurz, ob die Aufgabe inzwischen schon erledigt oder neu zugewiesen wurde.',
		};
	}
	if (action.type === 'chore.create') {
		return {
			title: 'Putzplan prüfen',
			detail: 'Prüfe kurz, ob Aufgabe, Intervall oder Zuweisung inzwischen geändert wurden.',
		};
	}
	if (action.type === 'shopping.update') {
		return {
			title: 'Status prüfen',
			detail: 'Prüfe kurz, ob der Einkauf inzwischen von jemand anderem geändert wurde.',
		};
	}
	if (action.type === 'announcement.create') {
		return {
			title: 'Pinnwand prüfen',
			detail: 'Prüfe kurz, ob Inhalt, Kategorie oder Status inzwischen überholt sind.',
		};
	}
	if (action.type === 'expense.create') {
		return {
			title: 'Aufteilung prüfen',
			detail:
				'Wenn sich Mitglieder oder Beträge geändert haben, bearbeite die Ausgabe vor dem Senden.',
		};
	}
	if (action.type === 'absence.create') {
		return {
			title: 'Abwesenheit prüfen',
			detail: 'Prüfe kurz, ob Zeitraum oder Putzplan inzwischen geändert wurden.',
		};
	}
	if (action.type === 'recurring.create') {
		return {
			title: 'Fixkosten prüfen',
			detail: 'Prüfe Fälligkeit und Aufteilung, bevor die Vorlage gesendet wird.',
		};
	}
	if (action.type === 'recurring.advance') {
		return {
			title: 'Fixkosten prüfen',
			detail: 'Prüfe kurz, ob die Vorlage inzwischen schon weitergeschoben wurde.',
		};
	}
	return {
		title: 'Vor dem Senden prüfen',
		detail: 'Der Eintrag ist schon länger in der Warteschlange und könnte nicht mehr aktuell sein.',
	};
}
