import {
	type OfflineAction,
	createOfflineIdempotencyKey,
	explainOfflineActionFailure,
	isOfflineIdempotencyKey,
	serializeOfflineAction,
} from './offline-queue';
import { replayWindowReviewError } from './offline-store';

/** How a replay attempt is judged: which outcomes count as synced, retried or held for review. */

export const MISSING_PENDING_IMAGE_ERROR =
	'Bild fehlt: Der lokale Anhang ist nicht mehr verfügbar. Entferne den Anhang in der Offline-Warteschlange oder wähle das Bild erneut aus.';
const RECURRING_ADVANCE_ERROR =
	'Fixkosten-Vorlage nicht weitergeschoben: Die Ausgabe wurde erstellt. Die Vorlage bleibt zur Nachholung in der Warteschlange.';
export const REAUTH_REQUIRED_ERROR =
	'Erneute Anmeldung erforderlich: Öffne die WG erneut oder tritt mit einem aktuellen Einladungslink bei.';
export const IDEMPOTENCY_KEY_ERROR =
	'Die Aktion konnte nicht für das sichere Senden vorbereitet werden. Sie bleibt gespeichert und wird nicht gesendet; versuche es später erneut.';

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
	const idempotencyKey = createOfflineIdempotencyKey();
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
		lastError: RECURRING_ADVANCE_ERROR,
	};
}

export function backfillIdempotencyKey(action: OfflineAction): OfflineAction {
	if (isOfflineIdempotencyKey(action.idempotencyKey)) return action;
	const idempotencyKey = createOfflineIdempotencyKey();
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

export function needsManualOfflineResolution(action: OfflineAction): boolean {
	if (replayWindowReviewError(action)) return true;
	if (action.lastError?.startsWith('Server prüfen:')) return true;
	return (
		typeof action.payload.imageUrl === 'string' &&
		Boolean(
			action.lastError?.startsWith('Bild fehlt:') ||
				action.lastError?.startsWith('Bild wurde entfernt:'),
		)
	);
}

export function explainPendingImageUploadError(err: unknown): string | null {
	if (!(err instanceof Error)) return null;
	const match = /^(?:sign|upload)-failed:(\d+)(?::(.+))?$/.exec(err.message);
	if (!match) return null;
	if (match[2] === 'image_removed') {
		return 'Bild wurde entfernt: Entferne den Anhang in der Offline-Warteschlange oder wähle das Bild erneut aus.';
	}
	const status = Number(match[1]);
	const failure = explainOfflineActionFailure(status, match[2]);
	return `${failure.title}: ${failure.detail}`;
}
