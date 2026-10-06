import type { OfflineAction, OfflineActionType } from './offline-action';

export interface OfflineActionRequest {
	path: string;
	method: 'POST' | 'PATCH';
	body: Record<string, unknown>;
}

export interface OfflineActionSummary {
	title: string;
	detail: string;
}

export interface OfflineActionRisk {
	title: string;
	detail: string;
}

/**
 * Per-type behavior for the offline queue. Declared here in core rather
 * than split across features/<name>/offline.ts: the queue mechanism itself
 * (types, retry/staleness logic, request building) is one small, cohesive
 * unit, and splitting the ~9 handlers out would need a bootstrap module to
 * import every feature's offline.ts just for its registration side effect —
 * indirection with no reader benefit over this single table.
 *
 * Declared as a `Record<OfflineActionType, OfflineActionHandler>` literal
 * (below) rather than a Map so the compiler enforces that every action type
 * has a handler — add a type to the union and `tsc` fails until its entry
 * is added here, which a Map's runtime `.get()`/`.set()` can't guarantee.
 */
interface OfflineActionHandler {
	buildRequest(action: OfflineAction): OfflineActionRequest;
	summary(action: OfflineAction): OfflineActionSummary;
	/** "Check before resending" hint shown once an action is stale or has already failed once. */
	risk(action: OfflineAction): OfflineActionRisk;
}

function pathSegment(value: unknown): string {
	return encodeURIComponent(String(value));
}

const STALE_ACTION_RISK: OfflineActionRisk = {
	title: 'Vor dem Senden prüfen',
	detail: 'Der Eintrag ist schon länger in der Warteschlange und könnte nicht mehr aktuell sein.',
};

export const offlineActionHandlers: Record<OfflineActionType, OfflineActionHandler> = {
	'shopping.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/shopping`,
			method: 'POST',
			body: { ...action.payload, addedByMemberId: action.memberId },
		}),
		summary: (action) => ({
			title: 'Einkauf',
			detail: String(action.payload.name ?? 'Neuer Artikel'),
		}),
		// No type-specific risk hint for this action; falls back to the generic staleness warning.
		risk: () => STALE_ACTION_RISK,
	},

	'shopping.update': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/shopping/${pathSegment(action.payload.itemId)}`,
			method: 'PATCH',
			body: {
				bought: action.payload.bought,
				expectedUpdatedAt: action.payload.expectedUpdatedAt,
				expectedBoughtAt: action.payload.expectedBoughtAt,
			},
		}),
		summary: (action) => ({
			title: 'Einkauf',
			detail: `${String(action.payload.name ?? 'Artikel')} ${
				action.payload.bought === true ? 'abhaken' : 'wieder öffnen'
			}`,
		}),
		risk: () => ({
			title: 'Status prüfen',
			detail: 'Prüfe kurz, ob der Einkauf inzwischen von jemand anderem geändert wurde.',
		}),
	},

	'announcement.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/announcements`,
			method: 'POST',
			body: Object.fromEntries(
				Object.entries(action.payload).filter(([, value]) => value !== null),
			),
		}),
		summary: (action) => ({
			title: 'Pinnwand-Beitrag',
			detail: String(action.payload.content ?? 'Neuer Beitrag'),
		}),
		risk: () => ({
			title: 'Pinnwand prüfen',
			detail: 'Prüfe kurz, ob Inhalt, Kategorie oder Status inzwischen überholt sind.',
		}),
	},

	'absence.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/absences`,
			method: 'POST',
			body: Object.fromEntries(
				Object.entries(action.payload).filter(([, value]) => value !== null),
			),
		}),
		summary: () => ({
			title: 'Abwesenheit',
			detail: 'Rotation überspringt diese Person',
		}),
		risk: () => ({
			title: 'Abwesenheit prüfen',
			detail: 'Prüfe kurz, ob Zeitraum oder Putzplan inzwischen geändert wurden.',
		}),
	},

	'chore.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/chores`,
			method: 'POST',
			body: action.payload,
		}),
		summary: (action) => ({
			title: 'Putzplan-Aufgabe',
			detail: String(action.payload.title ?? 'Neue Aufgabe'),
		}),
		risk: () => ({
			title: 'Putzplan prüfen',
			detail: 'Prüfe kurz, ob Aufgabe, Intervall oder Zuweisung inzwischen geändert wurden.',
		}),
	},

	'chore.complete': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/chores/${pathSegment(action.payload.choreId)}/complete`,
			method: 'POST',
			body: {
				expectedNextDueAt: action.payload.expectedNextDueAt,
				expectedAssignedMemberId: action.payload.expectedAssignedMemberId,
			},
		}),
		summary: () => ({
			title: 'Putzplan',
			detail: 'Aufgabe als erledigt markieren',
		}),
		risk: () => ({
			title: 'Möglicher Konflikt',
			detail: 'Prüfe kurz, ob die Aufgabe inzwischen schon erledigt oder neu zugewiesen wurde.',
		}),
	},

	'expense.create': {
		buildRequest: (action) => {
			return {
				path: `/api/wg/${pathSegment(action.shareCode)}/expenses`,
				method: 'POST',
				body: Object.fromEntries(
					Object.entries(action.payload).filter(([, value]) => value !== null),
				),
			};
		},

		summary: (action) => ({
			title: 'Ausgabe',
			detail: String(action.payload.description ?? 'Neue Ausgabe'),
		}),
		risk: () => ({
			title: 'Aufteilung prüfen',
			detail:
				'Wenn sich Mitglieder oder Beträge geändert haben, bearbeite die Ausgabe vor dem Senden.',
		}),
	},

	'expense.update': {
		buildRequest: (action) => {
			const { expenseId, ...expensePayload } = action.payload;
			return {
				path: `/api/wg/${pathSegment(action.shareCode)}/expenses/${pathSegment(expenseId)}`,
				method: 'PATCH',
				body: expensePayload,
			};
		},
		summary: (action) => ({
			title: 'Ausgabe aktualisieren',
			detail: String(action.payload.description ?? 'Ausgabe'),
		}),
		risk: () => ({
			title: 'Version prüfen',
			detail: 'Die Ausgabe wird nur aktualisiert, wenn sie seit dem Bearbeiten unverändert blieb.',
		}),
	},

	'recurring.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/recurring-expenses`,
			method: 'POST',
			body: action.payload,
		}),
		summary: (action) => ({
			title: 'Fixkosten-Vorlage',
			detail: String(action.payload.description ?? 'Neue Vorlage'),
		}),
		risk: () => ({
			title: 'Fixkosten prüfen',
			detail: 'Prüfe Fälligkeit und Aufteilung, bevor die Vorlage gesendet wird.',
		}),
	},

	'recurring.advance': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/recurring-expenses`,
			method: 'PATCH',
			body: {
				id: action.payload.recurringExpenseId,
				...(typeof action.payload.expectedRecurringNextDueAt === 'string'
					? { expectedNextDueAt: action.payload.expectedRecurringNextDueAt }
					: {}),
			},
		}),
		summary: () => ({
			title: 'Fixkosten-Vorlage',
			detail: 'Fälligkeit nachholen',
		}),
		risk: () => ({
			title: 'Fixkosten prüfen',
			detail: 'Prüfe kurz, ob die Vorlage inzwischen schon weitergeschoben wurde.',
		}),
	},
};
