import type { Message } from '@/shared/i18n/message';
import type { OfflineAction, OfflineActionType } from './offline-action';

export interface OfflineActionRequest {
	path: string;
	method: 'POST' | 'PATCH';
	body: Record<string, unknown>;
}

export interface OfflineActionSummary {
	title: Message;
	detail: Message;
}

export interface OfflineActionRisk {
	title: Message;
	detail: Message;
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

/** A user-written value as a message, or `fallback` when the payload has none. */
function written(value: unknown, fallback: Message): Message {
	return value == null
		? fallback
		: { key: 'offline.summary.verbatim', values: { text: String(value) } };
}

function risk(
	name:
		| 'stale'
		| 'shoppingUpdate'
		| 'announcement'
		| 'absence'
		| 'chore'
		| 'choreComplete'
		| 'expense'
		| 'expenseUpdate'
		| 'recurring'
		| 'recurringAdvance',
): OfflineActionRisk {
	return {
		title: { key: `offline.risk.${name}.title` },
		detail: { key: `offline.risk.${name}.detail` },
	};
}

const STALE_ACTION_RISK = risk('stale');

export const offlineActionHandlers: Record<OfflineActionType, OfflineActionHandler> = {
	'shopping.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/shopping`,
			method: 'POST',
			body: { ...action.payload, addedByMemberId: action.memberId },
		}),
		summary: (action) => ({
			title: { key: 'offline.summary.shopping.title' },
			detail: written(action.payload.name, { key: 'offline.summary.shopping.fallback' }),
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
			title: { key: 'offline.summary.shopping.title' },
			detail: {
				key: 'offline.summary.shoppingUpdate',
				values: {
					name: written(action.payload.name, { key: 'offline.summary.shopping.itemFallback' }),
					bought: action.payload.bought === true ? 'yes' : 'no',
				},
			},
		}),
		risk: () => risk('shoppingUpdate'),
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
			title: { key: 'offline.summary.announcement.title' },
			detail: written(action.payload.content, { key: 'offline.summary.announcement.fallback' }),
		}),
		risk: () => risk('announcement'),
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
			title: { key: 'offline.summary.absence.title' },
			detail: { key: 'offline.summary.absence.detail' },
		}),
		risk: () => risk('absence'),
	},

	'chore.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/chores`,
			method: 'POST',
			body: action.payload,
		}),
		summary: (action) => ({
			title: { key: 'offline.summary.chore.title' },
			detail: written(action.payload.title, { key: 'offline.summary.chore.fallback' }),
		}),
		risk: () => risk('chore'),
	},

	'chore.complete': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/chores/${pathSegment(action.payload.choreId)}/complete`,
			method: 'POST',
			body: {
				expectedNextDueAt: action.payload.expectedNextDueAt,
				expectedAssignedMemberId: action.payload.expectedAssignedMemberId,
				completedAt: action.payload.completedAt,
			},
		}),
		summary: () => ({
			title: { key: 'offline.summary.choreComplete.title' },
			detail: { key: 'offline.summary.choreComplete.detail' },
		}),
		risk: () => risk('choreComplete'),
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
			title: { key: 'offline.summary.expense.title' },
			detail: written(action.payload.description, { key: 'offline.summary.expense.fallback' }),
		}),
		risk: () => risk('expense'),
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
			title: { key: 'offline.summary.expenseUpdate.title' },
			detail: written(action.payload.description, {
				key: 'offline.summary.expenseUpdate.fallback',
			}),
		}),
		risk: () => risk('expenseUpdate'),
	},

	'recurring.create': {
		buildRequest: (action) => ({
			path: `/api/wg/${pathSegment(action.shareCode)}/recurring-expenses`,
			method: 'POST',
			body: action.payload,
		}),
		summary: (action) => ({
			title: { key: 'offline.summary.recurring.title' },
			detail: written(action.payload.description, { key: 'offline.summary.recurring.fallback' }),
		}),
		risk: () => risk('recurring'),
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
			title: { key: 'offline.summary.recurringAdvance.title' },
			detail: { key: 'offline.summary.recurringAdvance.detail' },
		}),
		risk: () => risk('recurringAdvance'),
	},
};
