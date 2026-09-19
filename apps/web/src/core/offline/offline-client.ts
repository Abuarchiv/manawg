'use client';

import { apiFetch } from '@/core/infra/api-client';
import { getIdentity } from '@/shared/lib/identity';
import { isPendingImageToken, uploadPendingImageToken } from './offline-images';
import {
	type OfflineAction,
	type OfflineActionType,
	createOfflineIdempotencyKey,
	explainOfflineActionFailure,
	getOfflineActionRequest,
	isOfflineIdempotencyKey,
	serializeOfflineAction,
	shouldRetryOfflineAction,
} from './offline-queue';

export const OFFLINE_QUEUE_KEY = 'manawg:offline-actions';
export const SYNCED_IDS_KEY = 'manawg:offline-synced-ids';
/** How long a "synced but queue-write failed" marker survives reloads. */
const SYNCED_IDS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const syncedAfterFailedQueueSave = new Set<string>();
const OFFLINE_ACTION_TYPES: ReadonlySet<OfflineActionType> = new Set([
	'shopping.create',
	'shopping.update',
	'announcement.create',
	'absence.create',
	'chore.create',
	'chore.complete',
	'expense.create',
	'expense.update',
	'recurring.create',
	'recurring.advance',
]);
const MISSING_PENDING_IMAGE_ERROR =
	'Bild fehlt: Der lokale Anhang ist auf diesem Gerät nicht mehr verfügbar. Die Aktion bleibt ohne Anhang sendbar; wähle das Bild bei Bedarf erneut aus.';
const RECURRING_ADVANCE_ERROR =
	'Fixkosten-Vorlage nicht weitergeschoben: Die Ausgabe wurde erstellt. Die Vorlage bleibt zur Nachholung in der Warteschlange.';
const REAUTH_REQUIRED_ERROR =
	'Erneute Anmeldung erforderlich: Öffne die WG erneut oder tritt mit einem aktuellen Einladungslink bei.';
const IDEMPOTENCY_KEY_ERROR =
	'Idempotenz-Schlüssel konnte nicht erzeugt werden. Die Aktion bleibt gespeichert und wird nicht gesendet.';
const syncInFlight = new Map<string, Promise<number>>();
let syncTail: Promise<unknown> = Promise.resolve();

interface OfflineSyncOptions {
	force?: boolean;
	memberId?: string;
}

function getSyncScopeKey(shareCode?: string, options?: OfflineSyncOptions): string {
	return `${shareCode ?? '*'}:${options?.memberId ?? '*'}:${options?.force ? 'force' : 'auto'}`;
}

function getOfflineStorage(): Storage | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
	return typeof value === 'string' || value === null;
}

function isOptionalStringOrNull(value: unknown): value is string | null | undefined {
	return value === undefined || isStringOrNull(value);
}

function isSplitArray(
	value: unknown,
): value is Array<{ debtorMemberId: string; amountCents: number }> {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(split) =>
				isRecord(split) &&
				typeof split.debtorMemberId === 'string' &&
				typeof split.amountCents === 'number',
		)
	);
}

function hasValidPayload(type: OfflineActionType, payload: Record<string, unknown>): boolean {
	switch (type) {
		case 'shopping.create':
			return (
				typeof payload.name === 'string' &&
				isOptionalStringOrNull(payload.quantity) &&
				(payload.bought === undefined || typeof payload.bought === 'boolean')
			);
		case 'shopping.update':
			return (
				typeof payload.itemId === 'string' &&
				typeof payload.name === 'string' &&
				typeof payload.bought === 'boolean'
			);
		case 'announcement.create':
			return (
				typeof payload.content === 'string' &&
				typeof payload.kind === 'string' &&
				isOptionalStringOrNull(payload.imageUrl)
			);
		case 'absence.create':
			return (
				typeof payload.memberId === 'string' &&
				typeof payload.startDate === 'string' &&
				typeof payload.endDate === 'string' &&
				isOptionalStringOrNull(payload.reason)
			);
		case 'chore.create':
			return (
				typeof payload.title === 'string' &&
				typeof payload.intervalDays === 'number' &&
				isOptionalStringOrNull(payload.assignedMemberId)
			);
		case 'chore.complete':
			return typeof payload.choreId === 'string';
		case 'expense.create':
			return (
				typeof payload.description === 'string' &&
				typeof payload.amountCents === 'number' &&
				typeof payload.paidByMemberId === 'string' &&
				isSplitArray(payload.splits) &&
				isOptionalStringOrNull(payload.imageUrl)
			);
		case 'expense.update':
			return (
				typeof payload.expenseId === 'string' &&
				typeof payload.expectedUpdatedAt === 'string' &&
				typeof payload.description === 'string' &&
				typeof payload.amountCents === 'number' &&
				typeof payload.paidByMemberId === 'string' &&
				isSplitArray(payload.splits) &&
				isOptionalStringOrNull(payload.imageUrl)
			);
		case 'recurring.create':
			return (
				typeof payload.description === 'string' &&
				typeof payload.amountCents === 'number' &&
				typeof payload.paidByMemberId === 'string' &&
				typeof payload.intervalMonths === 'number' &&
				typeof payload.nextDueAt === 'string' &&
				isSplitArray(payload.splits)
			);
		case 'recurring.advance':
			return (
				typeof payload.recurringExpenseId === 'string' &&
				typeof payload.expectedRecurringNextDueAt === 'string'
			);
	}
}

function isOfflineAction(value: unknown): value is OfflineAction {
	if (!isRecord(value)) return false;
	if (
		typeof value.id !== 'string' ||
		typeof value.type !== 'string' ||
		typeof value.shareCode !== 'string' ||
		typeof value.memberId !== 'string' ||
		typeof value.createdAt !== 'string' ||
		!isRecord(value.payload)
	) {
		return false;
	}
	if (value.wgId !== undefined && typeof value.wgId !== 'string') return false;
	const type = value.type as OfflineActionType;
	return OFFLINE_ACTION_TYPES.has(type) && hasValidPayload(type, value.payload);
}

function readPersistedSyncedIds(): string[] {
	const storage = getOfflineStorage();
	if (!storage) return [];
	try {
		const raw = storage.getItem(SYNCED_IDS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed)) return [];
		const now = Date.now();
		return Object.entries(parsed)
			.filter(
				([id, ts]) =>
					typeof id === 'string' && typeof ts === 'number' && now - ts < SYNCED_IDS_TTL_MS,
			)
			.map(([id]) => id);
	} catch {
		return [];
	}
}

function persistSyncedIds(ids: string[]): void {
	const storage = getOfflineStorage();
	if (!storage) return;
	try {
		const raw = storage.getItem(SYNCED_IDS_KEY);
		const parsed = isRecord(raw ? (JSON.parse(raw) as unknown) : null) ? raw : null;
		const map: Record<string, number> = parsed
			? (JSON.parse(parsed) as Record<string, number>)
			: {};
		const now = Date.now();
		for (const [id, ts] of Object.entries(map)) {
			if (typeof ts !== 'number' || now - ts >= SYNCED_IDS_TTL_MS) delete map[id];
		}
		for (const id of ids) map[id] = now;
		storage.setItem(SYNCED_IDS_KEY, JSON.stringify(map));
	} catch {
		// Best-effort marker; the in-memory set still covers this session.
	}
}

export function readOfflineQueue(): OfflineAction[] {
	const storage = getOfflineStorage();
	if (!storage) return [];
	try {
		const raw = storage.getItem(OFFLINE_QUEUE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		const persistedSynced = new Set(readPersistedSyncedIds());
		return Array.isArray(parsed)
			? parsed
					.filter(isOfflineAction)
					.filter((action) => !syncedAfterFailedQueueSave.has(action.id))
					.filter((action) => !persistedSynced.has(action.id))
			: [];
	} catch {
		return [];
	}
}

export function countOfflineActions(shareCode?: string, options?: { memberId?: string }): number {
	const queue = readOfflineQueue();
	return queue.filter(
		(item) =>
			(!shareCode || item.shareCode === shareCode) &&
			(!options?.memberId || item.memberId === options.memberId),
	).length;
}

export function writeOfflineQueue(actions: OfflineAction[]): boolean {
	const storage = getOfflineStorage();
	if (!storage) return false;
	try {
		storage.setItem(OFFLINE_QUEUE_KEY, `[${actions.map(serializeOfflineAction).join(',')}]`);
		for (const action of actions) {
			syncedAfterFailedQueueSave.delete(action.id);
		}
		window.dispatchEvent(new CustomEvent('manawg:offline-queue'));
		return true;
	} catch {
		// Offline queue persistence is best-effort when browser storage is blocked.
		return false;
	}
}

export function enqueueOfflineAction(action: OfflineAction): number {
	const next = [...readOfflineQueue(), action];
	return writeOfflineQueue(next) ? next.length : 0;
}

async function resolvePendingImages(action: OfflineAction): Promise<OfflineAction> {
	const imageUrl = action.payload.imageUrl;
	if (typeof imageUrl !== 'string' || !isPendingImageToken(imageUrl)) return action;
	const publicUrl = await uploadPendingImageToken(imageUrl, action.memberId);
	return {
		...action,
		payload: {
			...action.payload,
			imageUrl: publicUrl,
		},
	};
}

function removeMissingPendingImage(action: OfflineAction): OfflineAction {
	const imageUrl = action.payload.imageUrl;
	if (typeof imageUrl !== 'string' || !isPendingImageToken(imageUrl)) return action;
	return {
		...action,
		payload: {
			...action.payload,
			imageUrl: null,
		},
	};
}

function getRecurringAdvancePayload(
	action: OfflineAction,
): { id: string; expectedNextDueAt?: string } | null {
	const recurringExpenseId = action.payload.recurringExpenseId;
	if (typeof recurringExpenseId !== 'string') return null;
	const expectedNextDueAt = action.payload.expectedRecurringNextDueAt;
	if (typeof expectedNextDueAt !== 'string') return null;
	return {
		id: recurringExpenseId,
		expectedNextDueAt,
	};
}

function createRecurringAdvanceRetry(action: OfflineAction, now: number): OfflineAction | null {
	if (action.type !== 'expense.create') return null;
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

function backfillIdempotencyKey(action: OfflineAction): OfflineAction {
	if (isOfflineIdempotencyKey(action.idempotencyKey)) return action;
	const idempotencyKey = createOfflineIdempotencyKey();
	return idempotencyKey ? { ...action, idempotencyKey } : action;
}

function isRecurringAlreadyAdvanced(res: { status: number; error: string }): boolean {
	return res.status === 409 && res.error === 'recurring_expense_already_advanced';
}

function isChoreAlreadyCompleted(
	action: OfflineAction,
	res: { status: number; error: string },
): boolean {
	return (
		action.type === 'chore.complete' &&
		res.status === 409 &&
		res.error === 'chore_already_completed'
	);
}

function explainPendingImageUploadError(err: unknown): string | null {
	if (!(err instanceof Error)) return null;
	const match = /^(?:sign|upload)-failed:(\d+)(?::(.+))?$/.exec(err.message);
	if (!match) return null;
	const status = Number(match[1]);
	const failure = explainOfflineActionFailure(status, match[2]);
	return `${failure.title}: ${failure.detail}`;
}

export async function syncOfflineActions(
	shareCode?: string,
	options?: OfflineSyncOptions,
): Promise<number> {
	const scopeKey = getSyncScopeKey(shareCode, options);
	const running = syncInFlight.get(scopeKey);
	if (running) return running;
	const next = syncTail.then(() => runOfflineSync(shareCode, options));
	syncTail = next.catch(() => undefined);
	syncInFlight.set(scopeKey, next);
	try {
		return await next;
	} finally {
		syncInFlight.delete(scopeKey);
	}
}

async function runOfflineSync(shareCode?: string, options?: OfflineSyncOptions): Promise<number> {
	const storedQueue = readOfflineQueue();
	if (storedQueue.length === 0) return 0;
	const queue = storedQueue.map(backfillIdempotencyKey);
	// Probe storage writability BEFORE spending network calls — if we cannot
	// persist removals, replaying would duplicate mutations. This rewrite of
	// the just-read snapshot races with concurrent enqueues only for the few
	// microseconds until the next line; the final write-back below re-reads
	// and merges, which is what actually protects longer-running syncs.
	if (!writeOfflineQueue(queue)) return 0;
	const remaining: OfflineAction[] = [];
	let synced = 0;
	const syncedActionIds: string[] = [];
	const syncedByShareCode: Record<string, number> = {};
	const now = Date.now();
	const recordSynced = (action: OfflineAction) => {
		synced += 1;
		syncedActionIds.push(action.id);
		syncedByShareCode[action.shareCode] = (syncedByShareCode[action.shareCode] ?? 0) + 1;
	};

	for (const action of queue) {
		if (shareCode && action.shareCode !== shareCode) {
			remaining.push(action);
			continue;
		}
		if (options?.memberId && action.memberId !== options.memberId) {
			remaining.push(action);
			continue;
		}
		if (!options?.force && !shouldRetryOfflineAction(action, now)) {
			remaining.push(action);
			continue;
		}
		const idempotencyKey = action.idempotencyKey;
		if (!isOfflineIdempotencyKey(idempotencyKey)) {
			remaining.push({
				...action,
				attempts: (action.attempts ?? 0) + 1,
				lastAttemptAt: new Date(now).toISOString(),
				lastError: IDEMPOTENCY_KEY_ERROR,
			});
			continue;
		}
		const identity = action.wgId ? getIdentity(action.wgId) : null;
		const activeMemberId = options?.memberId ?? identity?.memberId;
		if (!activeMemberId || activeMemberId !== action.memberId) {
			remaining.push({
				...action,
				attempts: (action.attempts ?? 0) + 1,
				lastAttemptAt: new Date(now).toISOString(),
				lastError: REAUTH_REQUIRED_ERROR,
			});
			continue;
		}
		try {
			const readyAction = await resolvePendingImages(action);
			const request = getOfflineActionRequest(readyAction);
			const res = await apiFetch<unknown>(request.path, {
				method: request.method,
				memberId: readyAction.memberId,
				...(identity?.memberToken ? { memberToken: identity.memberToken } : {}),
				body: JSON.stringify(request.body),
				// Server deduplicates POSTs by this header — without it a lost
				// response (status 0) would be retried into a duplicate mutation.
				...(request.method === 'POST' ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
			});
			if (res.ok) {
				recordSynced(readyAction);
				const recurringAdvance = getRecurringAdvancePayload(readyAction);
				if (recurringAdvance) {
					try {
						const advanceRes = await apiFetch<unknown>(
							`/api/wg/${encodeURIComponent(readyAction.shareCode)}/recurring-expenses`,
							{
								method: 'PATCH',
								memberId: readyAction.memberId,
								...(identity?.memberToken ? { memberToken: identity.memberToken } : {}),
								body: JSON.stringify(recurringAdvance),
							},
						);
						if (!advanceRes.ok && !isRecurringAlreadyAdvanced(advanceRes)) {
							const retry = createRecurringAdvanceRetry(readyAction, now);
							if (retry) remaining.push(retry);
						}
					} catch {
						const retry = createRecurringAdvanceRetry(readyAction, now);
						if (retry) remaining.push(retry);
					}
				}
			} else if (
				(readyAction.type === 'recurring.advance' && isRecurringAlreadyAdvanced(res)) ||
				isChoreAlreadyCompleted(readyAction, res)
			) {
				recordSynced(readyAction);
			} else {
				const failure = explainOfflineActionFailure(res.status, res.error);
				remaining.push({
					...readyAction,
					attempts: (readyAction.attempts ?? 0) + 1,
					lastAttemptAt: new Date(now).toISOString(),
					lastError: `${failure.title}: ${failure.detail}`,
				});
			}
		} catch (err) {
			const missingPendingImage = err instanceof Error && err.message === 'pending-image-missing';
			const retryAction = missingPendingImage ? removeMissingPendingImage(action) : action;
			const pendingImageUploadError = explainPendingImageUploadError(err);
			const lastError = missingPendingImage
				? MISSING_PENDING_IMAGE_ERROR
				: (pendingImageUploadError ??
					(() => {
						const failure = explainOfflineActionFailure(0);
						return `${failure.title}: ${failure.detail}`;
					})());
			remaining.push({
				...retryAction,
				attempts: (retryAction.attempts ?? 0) + 1,
				lastAttemptAt: new Date(now).toISOString(),
				lastError,
			});
		}
	}

	// Re-read instead of trusting the startup snapshot: actions enqueued (or
	// removed by the user) while this sync was in flight must survive the
	// write-back. Keep everything not processed by THIS run, plus our
	// remaining set.
	const processedIds = new Set(queue.map((action) => action.id));
	const current = readOfflineQueue().filter((action) => !processedIds.has(action.id));
	const queueSaved = writeOfflineQueue([...current, ...remaining]);
	if (!queueSaved) {
		for (const actionId of syncedActionIds) {
			syncedAfterFailedQueueSave.add(actionId);
		}
		persistSyncedIds(syncedActionIds);
	}
	if (synced > 0) {
		window.dispatchEvent(
			new CustomEvent('manawg:offline-synced', { detail: { synced, syncedByShareCode } }),
		);
	}
	return synced;
}

/**
 * How many of a `manawg:offline-synced` event's flushed actions belonged to
 * this WG. Shared by every listener that needs to react per-WG (e.g. refresh
 * this page's data, or show a per-WG toast) instead of on any sync anywhere.
 */
export function getSyncedCountForWg(event: Event, shareCode: string): number {
	if (!(event instanceof CustomEvent)) return 0;
	const syncedByShareCode = event.detail?.syncedByShareCode;
	if (syncedByShareCode && typeof syncedByShareCode === 'object') {
		const scoped = syncedByShareCode[shareCode];
		return typeof scoped === 'number' ? scoped : 0;
	}
	return typeof event.detail?.synced === 'number' ? event.detail.synced : 0;
}
