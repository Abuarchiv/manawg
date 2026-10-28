import { createIdempotencyKey, isIdempotencyKey } from '@/core/http/idempotency-key';
import {
	type FailureState,
	IMAGE_REMOVED_STATE,
	holdsImageReview,
	holdsServerReview,
	noteState,
	requestFailureState,
} from './offline-failure-copy';
import { type OfflineAction, serializeOfflineAction } from './offline-queue';
import { replayWindowReviewError } from './offline-store';

/** How a replay attempt is judged: which outcomes count as synced, retried or held for review. */

export function sameOfflineAction(left: OfflineAction, right: OfflineAction): boolean {
	return serializeOfflineAction(left) === serializeOfflineAction(right);
}

export function needsReviewAfterRequest(current: OfflineAction, snapshot: OfflineAction): boolean {
	return (
		JSON.stringify(current.payload) !== JSON.stringify(snapshot.payload) ||
		current.idempotencyKey !== snapshot.idempotencyKey
	);
}

export function mergeSyncOutcomes(
	current: OfflineAction[],
	outcomes: Map<string, { snapshot: OfflineAction; retry?: OfflineAction; reviewOnEdit?: boolean }>,
	reviewIds: Set<string>,
): OfflineAction[] {
	return current.flatMap((action) => {
		const outcome = outcomes.get(action.id);
		if (!outcome || !sameOfflineAction(action, outcome.snapshot)) {
			if (outcome?.reviewOnEdit && needsReviewAfterRequest(action, outcome.snapshot)) {
				reviewIds.add(action.id);
			}
			return [action];
		}
		return outcome.retry ? [outcome.retry] : [];
	});
}

export function getRecurringAdvancePayload(
	action: OfflineAction,
): { id: string; expectedNextDueAt?: string } | null {
	if (action.type !== 'expense.create') return null;
	const recurringExpenseId = action.payload.recurringExpenseId;
	if (typeof recurringExpenseId !== 'string') return null;
	const expectedNextDueAt = action.payload.expectedRecurringNextDueAt;
	if (typeof expectedNextDueAt !== 'string') return null;
	return {
		id: recurringExpenseId,
		expectedNextDueAt,
	};
}

export function createRecurringAdvanceRetry(
	action: OfflineAction,
	now: number,
): OfflineAction | null {
	const payload = getRecurringAdvancePayload(action);
	if (!payload) return null;
	const idempotencyKey = createIdempotencyKey();
	return {
		id: `recurring-advance:${action.shareCode}:${payload.id}`,
		...(idempotencyKey ? { idempotencyKey } : {}),
		type: 'recurring.advance',
		shareCode: action.shareCode,
		...(action.wgId ? { wgId: action.wgId } : {}),
		memberId: action.memberId,
		createdAt: new Date(now).toISOString(),
		payload: {
			recurringExpenseId: payload.id,
			...(payload.expectedNextDueAt
				? { expectedRecurringNextDueAt: payload.expectedNextDueAt }
				: {}),
		},
		attempts: 1,
		lastAttemptAt: new Date(now).toISOString(),
		...noteState('recurringAdvance'),
	};
}

export function backfillIdempotencyKey(action: OfflineAction): OfflineAction {
	if (isIdempotencyKey(action.idempotencyKey)) return action;
	const idempotencyKey = createIdempotencyKey();
	return idempotencyKey ? { ...action, idempotencyKey } : action;
}

export function isRecurringAlreadyAdvanced(res: { status: number; error: string }): boolean {
	return res.status === 409 && res.error === 'recurring_expense_already_advanced';
}

export function isChoreAlreadyCompleted(
	action: OfflineAction,
	res: { status: number; error: string },
): boolean {
	return (
		action.type === 'chore.complete' &&
		res.status === 409 &&
		res.error === 'chore_already_completed'
	);
}

/** The item is already on the open list (e.g. a housemate added it): the goal is met. */
export function isShoppingAlreadyOnList(
	action: OfflineAction,
	res: { status: number; error: string },
): boolean {
	return (
		action.type === 'shopping.create' &&
		res.status === 409 &&
		res.error === 'shopping_item_duplicate'
	);
}

/**
 * The server answered and will answer the same way again, so replaying changes
 * nothing: only transport failures (0), timeouts (408), Too Early (425) and the
 * rate limit (429) are worth another attempt. 409 conflicts are handled before
 * this and count as done.
 */
export function isTerminalReplayStatus(status: number): boolean {
	return status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429;
}

export function needsManualOfflineResolution(action: OfflineAction): boolean {
	if (replayWindowReviewError(action)) return true;
	if (holdsServerReview(action)) return true;
	return typeof action.payload.imageUrl === 'string' && holdsImageReview(action);
}

/** The state a failed pending-image upload records, or null for errors of another kind. */
export function pendingImageUploadFailure(err: unknown): FailureState | null {
	if (!(err instanceof Error)) return null;
	const match = /^(?:sign|upload)-failed:(\d+)(?::(.+))?$/.exec(err.message);
	if (!match) return null;
	if (match[2] === 'image_removed') return IMAGE_REMOVED_STATE;
	return requestFailureState(Number(match[1]), match[2], false);
}
