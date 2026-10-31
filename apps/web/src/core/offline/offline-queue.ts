import { MS_PER_HOUR, parseTimestamp } from '@/core/utils/time';
import type { OfflineAction } from './offline-action';
import {
	type OfflineActionRequest,
	type OfflineActionRisk,
	type OfflineActionSummary,
	offlineActionHandlers,
} from './offline-action-handlers';
import {
	explainOfflineActionFailure,
	failedWithoutConnection,
	holdsServerReview,
} from './offline-failure-copy';

export type {
	OfflineAction,
	OfflineActionType,
} from './offline-action';
export {
	createQueuedAbsence,
	createQueuedAnnouncement,
	createQueuedChore,
	createQueuedChoreCompletion,
	createQueuedExpense,
	createQueuedExpenseUpdate,
	createQueuedRecurring,
	createQueuedShoppingItem,
	createQueuedShoppingUpdate,
} from './offline-action-builders';
export { explainOfflineActionFailure };

export function serializeOfflineAction(action: OfflineAction): string {
	return JSON.stringify(action);
}

export function getOfflineActionRequest(action: OfflineAction): OfflineActionRequest {
	return offlineActionHandlers[action.type].buildRequest(action);
}

export function hasQueuedShoppingUpdate(
	actions: readonly OfflineAction[],
	shareCode: string,
	memberId: string,
	itemId: string,
): boolean {
	return actions.some(
		(action) =>
			action.type === 'shopping.update' &&
			action.shareCode === shareCode &&
			action.memberId === memberId &&
			action.payload.itemId === itemId,
	);
}

/**
 * Appends `action` to the queue. A second edit of an expense whose first queued edit was never
 * sent replaces it in place and keeps the server version the first edit was made against, so
 * the single request that replays still matches what the server holds.
 */
export function withQueuedExpenseUpdate(
	actions: readonly OfflineAction[],
	action: OfflineAction,
): OfflineAction[] {
	if (action.type !== 'expense.update') return [...actions, action];
	const index = actions.findIndex(
		(queued) =>
			queued.type === 'expense.update' &&
			queued.shareCode === action.shareCode &&
			queued.memberId === action.memberId &&
			queued.payload.expenseId === action.payload.expenseId &&
			!queued.lastAttemptAt &&
			!queued.needsReview,
	);
	const queued = actions[index];
	if (!queued) return [...actions, action];
	const merged = {
		...action,
		payload: { ...action.payload, expectedUpdatedAt: queued.payload.expectedUpdatedAt },
	};
	return actions.map((entry, i) => (i === index ? merged : entry));
}

/**
 * Chore occurrences with a completion still waiting to sync. Lost connections and server errors
 * retry later; a completion the server rejected is held for review and needs the user, so its
 * chore shows again.
 */
export function pendingChoreCompletions(
	actions: readonly OfflineAction[],
	shareCode: string,
): Array<{ id: string; nextDueAt: string }> {
	return actions
		.filter(
			(action) =>
				action.type === 'chore.complete' &&
				action.shareCode === shareCode &&
				!holdsServerReview(action),
		)
		.map((action) => ({
			id: String(action.payload.choreId),
			nextDueAt: String(action.payload.expectedNextDueAt),
		}));
}

const QUEUED_CREATE_ID_RE = /^(?:shopping|chore-create|absence):[^:]+:\d+:/;

/**
 * True for the synthetic id of a create made offline (e.g.
 * `shopping:<code>:<ms>:<slug>`). The server never issues such ids, so a row
 * carrying one is local-only even after its queue entry was discarded.
 */
export function isQueuedCreateId(id: string): boolean {
	return QUEUED_CREATE_ID_RE.test(id);
}

/**
 * Returns the queue without the queued create `id` of this WG and without
 * follow-up actions that target it, or `null` when no such entry is queued.
 */
export function withoutQueuedEntry(
	actions: readonly OfflineAction[],
	shareCode: string,
	id: string,
): OfflineAction[] | null {
	const sameWg = (action: OfflineAction) => action.shareCode === shareCode;
	if (!actions.some((action) => sameWg(action) && action.id === id)) return null;
	return actions.filter(
		(action) =>
			!(
				sameWg(action) &&
				(action.id === id || action.payload.itemId === id || action.payload.choreId === id)
			),
	);
}

export function getOfflineActionSummary(action: OfflineAction): OfflineActionSummary {
	return offlineActionHandlers[action.type].summary(action);
}

const BASE_RETRY_DELAY_MS = 15_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
/** Older queued actions get a risk hint even without an error. */
const REVIEW_AFTER_HOURS = 6;

function getOfflineRetryDelayMs(action: OfflineAction): number {
	const attempts = action.attempts ?? 0;
	if (attempts <= 0) return 0;
	return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** attempts);
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
			title: { key: 'offline.risk.timeUnclear.title' },
			detail: { key: 'offline.risk.timeUnclear.detail' },
		};
	}
	if (createdAt > now) {
		return {
			title: { key: 'offline.risk.timeFuture.title' },
			detail: { key: 'offline.risk.timeFuture.detail' },
		};
	}
	const ageHours = Math.floor((now - createdAt) / MS_PER_HOUR);
	const hasError = Boolean(action.lastError || action.lastErrorMessage);
	if (ageHours < REVIEW_AFTER_HOURS && !hasError) return null;
	// A fresh no-connection failure says nothing about the server state.
	if (ageHours < REVIEW_AFTER_HOURS && failedWithoutConnection(action)) return null;
	return offlineActionHandlers[action.type].risk(action);
}
