import { belongsToAccount, getLocalAccount, setLocalAccount } from '@/core/auth/local-account';
import { safeLocalStorage } from '@/core/utils/browser';
import { isRecord } from '@/core/utils/is-record';
import { isOfflineAction } from './offline-action-guard';
import { SERVER_CHECK_PREFIX } from './offline-failure-copy';
import {
	type OfflineAction,
	isQueuedCreateId,
	serializeOfflineAction,
	withoutQueuedEntry,
} from './offline-queue';
import {
	OFFLINE_REPLAY_CLOCK_SKEW_MS,
	OFFLINE_REPLAY_MAX_AGE_MS,
	RESPONSE_REPLAY_TTL_SECONDS,
} from './replay-retention';

/**
 * The offline queue in local storage (`manawg:offline-actions`), written only under a
 * cross-tab Web Lock, plus the markers that keep a synced or edited action from being replayed
 * when the queue itself could not be saved.
 */

const OFFLINE_QUEUE_KEY = 'manawg:offline-actions';
const SYNCED_IDS_KEY = 'manawg:offline-synced-ids';
const OFFLINE_QUEUE_LOCK_NAME = 'manawg:offline-queue';
/** No expiry: replaying an edited action under its original key can drop the edit. */
const OFFLINE_REVIEW_IDS_KEY = 'manawg:offline-review-ids';
/** How long a "synced but queue-write failed" marker survives reloads. */
const SYNCED_IDS_TTL_MS = RESPONSE_REPLAY_TTL_SECONDS * 1000;
export const syncedAfterFailedQueueSave = new Set<string>();
export const reviewAfterFailedQueueSave = new Set<string>();
// This fallback lasts for the current page only; recovery across reloads would need IndexedDB.
let cachedOfflineQueue: OfflineAction[] | null = null;
export const REVIEW_REQUIRED_ERROR = `${SERVER_CHECK_PREFIX} Die erste Version kann bereits gespeichert sein. Die Bearbeitung wurde nicht gesendet. Vergleiche den WG-Eintrag und verwirf diese Aktion erst danach; lege benötigte Änderungen neu an.`;
const REPLAY_EXPIRED_ERROR = `${SERVER_CHECK_PREFIX} Die sichere Wiederholungsfrist ist abgelaufen. Diese Aktion kann bereits gespeichert sein und wird nicht erneut gesendet. Vergleiche den WG-Eintrag und verwirf diese Aktion erst danach; lege nur fehlende Änderungen neu an.`;
const INVALID_ACTION_TIME_ERROR = `${SERVER_CHECK_PREFIX} Der Zeitpunkt dieser Aktion ist unklar. Sie kann bereits gespeichert sein und wird nicht erneut gesendet. Vergleiche den WG-Eintrag und verwirf diese Aktion erst danach; lege nur fehlende Änderungen neu an.`;

type OfflineQueueLockResult<T> = { acquired: true; value: T } | { acquired: false };

function supportsOfflineQueueLocks(): boolean {
	return typeof navigator !== 'undefined' && Boolean(navigator.locks?.request);
}

/**
 * Cross-tab Web Locks need a secure context (https or localhost). Without them
 * the queue can be written but never replayed, so the UI has to say so instead
 * of showing a "send now" button that does nothing.
 */
export function offlineQueueReplaySupported(): boolean {
	return supportsOfflineQueueLocks();
}

export async function withOfflineQueueLock<T>(
	update: (storage: Storage) => T | Promise<T>,
): Promise<OfflineQueueLockResult<T>> {
	const storage = safeLocalStorage();
	if (!storage || !supportsOfflineQueueLocks()) return { acquired: false };
	try {
		const value = await navigator.locks.request(
			OFFLINE_QUEUE_LOCK_NAME,
			{ mode: 'exclusive' },
			() => update(storage),
		);
		return { acquired: true, value };
	} catch {
		return { acquired: false };
	}
}

/** Marker map `id -> timestamp`; anything that is not a finite-number entry is dropped. */
function readTimestampMap(storage: Storage, key: string): Record<string, number> {
	const raw = storage.getItem(key);
	const parsed = raw ? (JSON.parse(raw) as unknown) : null;
	if (!isRecord(parsed)) return {};
	return Object.fromEntries(
		Object.entries(parsed).filter(
			(entry): entry is [string, number] => typeof entry[1] === 'number',
		),
	);
}

function readPersistedSyncedIds(): string[] {
	const storage = safeLocalStorage();
	if (!storage) return [];
	try {
		const now = Date.now();
		return Object.entries(readTimestampMap(storage, SYNCED_IDS_KEY))
			.filter(([, ts]) => now - ts < SYNCED_IDS_TTL_MS)
			.map(([id]) => id);
	} catch {
		return [];
	}
}

export function persistSyncedIds(storage: Storage, ids: string[]): void {
	try {
		const map = readTimestampMap(storage, SYNCED_IDS_KEY);
		const now = Date.now();
		for (const [id, ts] of Object.entries(map)) {
			if (now - ts >= SYNCED_IDS_TTL_MS) delete map[id];
		}
		for (const id of ids) map[id] = now;
		storage.setItem(SYNCED_IDS_KEY, JSON.stringify(map));
	} catch {
		// Best-effort marker; the in-memory set still covers this session.
	}
}

function readPersistedReviewIds(): string[] {
	const storage = safeLocalStorage();
	if (!storage) return [];
	try {
		return Object.keys(readTimestampMap(storage, OFFLINE_REVIEW_IDS_KEY));
	} catch {
		return [];
	}
}

export function persistOfflineReviewIds(storage: Storage, ids: string[]): void {
	try {
		const map = readTimestampMap(storage, OFFLINE_REVIEW_IDS_KEY);
		const now = Date.now();
		for (const id of ids) map[id] = now;
		storage.setItem(OFFLINE_REVIEW_IDS_KEY, JSON.stringify(map));
	} catch {
		for (const id of ids) reviewAfterFailedQueueSave.add(id);
	}
}

function clearReviewIdsForMissingActions(actions: OfflineAction[], storage: Storage): void {
	const currentIds = new Set(actions.map((action) => action.id));
	for (const id of reviewAfterFailedQueueSave) {
		if (!currentIds.has(id)) reviewAfterFailedQueueSave.delete(id);
	}
	try {
		const map = readTimestampMap(storage, OFFLINE_REVIEW_IDS_KEY);
		let changed = false;
		for (const id of Object.keys(map)) {
			if (!currentIds.has(id)) {
				delete map[id];
				changed = true;
			}
		}
		if (changed) storage.setItem(OFFLINE_REVIEW_IDS_KEY, JSON.stringify(map));
	} catch {
		// Keep the marker if clearing it cannot be persisted.
	}
}

export function replayWindowReviewError(action: OfflineAction): string | null {
	const createdAt = Date.parse(action.createdAt);
	const now = Date.now();
	if (!Number.isFinite(createdAt) || createdAt > now + OFFLINE_REPLAY_CLOCK_SKEW_MS) {
		return INVALID_ACTION_TIME_ERROR;
	}
	// Creation is conservative: a crashed first attempt may never have saved attempt metadata.
	return now - createdAt >= OFFLINE_REPLAY_MAX_AGE_MS ? REPLAY_EXPIRED_ERROR : null;
}

function filterOfflineQueue(actions: OfflineAction[]): OfflineAction[] {
	const persistedSynced = new Set(readPersistedSyncedIds());
	const reviewIds = new Set([...reviewAfterFailedQueueSave, ...readPersistedReviewIds()]);
	return actions
		.filter((action) => !syncedAfterFailedQueueSave.has(action.id))
		.filter((action) => !persistedSynced.has(action.id))
		.map((action) => {
			const lastError =
				replayWindowReviewError(action) ??
				(reviewIds.has(action.id) ? REVIEW_REQUIRED_ERROR : null);
			return lastError ? { ...action, lastError } : action;
		});
}

function readCachedOfflineQueue(): OfflineAction[] {
	return filterOfflineQueue(cachedOfflineQueue ?? []);
}

export function readOfflineQueueFromStorage(storage: Storage): OfflineAction[] | null {
	try {
		const raw = storage.getItem(OFFLINE_QUEUE_KEY);
		if (!raw) {
			cachedOfflineQueue = [];
			return [];
		}
		const parsed = JSON.parse(raw) as unknown;
		const queue = Array.isArray(parsed) ? filterOfflineQueue(parsed.filter(isOfflineAction)) : [];
		cachedOfflineQueue = queue;
		return queue;
	} catch {
		return null;
	}
}

export function readOfflineQueue(): OfflineAction[] {
	const storage = safeLocalStorage();
	if (!storage) return readCachedOfflineQueue();
	return readOfflineQueueFromStorage(storage) ?? readCachedOfflineQueue();
}

/** False once the action left the queue, e.g. because a background sync already sent it. */
export function isOfflineActionQueued(id: string): boolean {
	return readOfflineQueue().some((item) => item.id === id);
}

export function countOfflineActions(shareCode?: string, options?: { memberId?: string }): number {
	const queue = readOfflineQueue();
	return queue.filter(
		(item) =>
			(!shareCode || item.shareCode === shareCode) &&
			(!options?.memberId || item.memberId === options.memberId),
	).length;
}

/** Actions that belong to the signed-in account; entries from before account binding go to the account recorded on this device. */
export function filterOfflineActionsForAuthUser(
	actions: OfflineAction[],
	authUserId: string | null | undefined,
): OfflineAction[] {
	if (!authUserId) return [];
	return actions.filter((action) => belongsToAccount(action.authUserId, authUserId));
}

/**
 * Records the signed-in account. On an account switch the previous account's queued actions are
 * dropped: they could only be replayed under the wrong session.
 */
export async function adoptLocalAccount(authUserId: string): Promise<void> {
	const previous = setLocalAccount(authUserId);
	if (!previous) return;
	await updateOfflineQueue((actions) => {
		const own = actions.filter((action) => (action.authUserId ?? previous) === authUserId);
		return own.length === actions.length ? null : own;
	});
}

/**
 * Entries this build cannot read (e.g. an action type from a newer deploy) are kept verbatim,
 * so a stale tab never drops them when it rewrites the queue.
 */
function readUnknownQueueEntries(storage: Storage): string[] {
	try {
		const parsed = JSON.parse(storage.getItem(OFFLINE_QUEUE_KEY) ?? '[]') as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((entry) => isRecord(entry) && !isOfflineAction(entry))
			.map((entry) => JSON.stringify(entry));
	} catch {
		return [];
	}
}

export function persistOfflineQueue(actions: OfflineAction[], storage: Storage): boolean {
	try {
		const entries = [...actions.map(serializeOfflineAction), ...readUnknownQueueEntries(storage)];
		storage.setItem(OFFLINE_QUEUE_KEY, `[${entries.join(',')}]`);
		for (const action of actions) {
			syncedAfterFailedQueueSave.delete(action.id);
		}
		clearReviewIdsForMissingActions(actions, storage);
		cachedOfflineQueue = filterOfflineQueue(actions);
		window.dispatchEvent(new CustomEvent('manawg:offline-queue'));
		return true;
	} catch {
		// Offline queue persistence is best-effort when browser storage is blocked.
		return false;
	}
}

export async function updateOfflineQueue(
	update: (actions: OfflineAction[]) => OfflineAction[] | null,
): Promise<boolean> {
	const result = await withOfflineQueueLock((storage) => {
		const current = readOfflineQueueFromStorage(storage);
		if (!current) return false;
		const next = update(current);
		return next === null || persistOfflineQueue(next, storage);
	});
	return result.acquired && result.value;
}

/**
 * Deletes a not-yet-synced create (and follow-ups that target it) locally.
 * Item routes reject the synthetic queue id, so a list delete must not call them.
 */
export async function discardQueuedEntry(
	shareCode: string,
	id: string,
): Promise<'removed' | 'not_queued' | 'storage_blocked'> {
	const queued = readOfflineQueue().some(
		(action) =>
			action.shareCode === shareCode &&
			(action.id === id || action.payload.itemId === id || action.payload.choreId === id),
	);
	if (!queued && !isQueuedCreateId(id) && (!supportsOfflineQueueLocks() || !safeLocalStorage())) {
		return 'not_queued';
	}
	let status: 'removed' | 'not_queued' = 'not_queued';
	const saved = await updateOfflineQueue((actions) => {
		const next = withoutQueuedEntry(actions, shareCode, id);
		if (!next) return null;
		status = 'removed';
		return next;
	});
	return saved ? status : 'storage_blocked';
}

export async function enqueueOfflineAction(action: OfflineAction): Promise<number> {
	let count = 0;
	// Tag the owner here, once: the account recorded when this tab loaded its member.
	const authUserId = action.authUserId ?? getLocalAccount();
	const owned = authUserId ? { ...action, authUserId } : action;
	const saved = await updateOfflineQueue((actions) => {
		const next = [...actions, owned];
		count = next.length;
		return next;
	});
	return saved ? count : 0;
}
