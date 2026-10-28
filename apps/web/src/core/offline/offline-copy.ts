import type { Message } from '@/shared/i18n/message';

/** Count of waiting actions in the settings queue. */
export function offlineQueueCountMessage(count: number): Message {
	return { key: 'offline.copy.queueCount', values: { count } };
}

/** Result of a manual sync: what was sent and what still waits. */
export function manualSyncResultMessage(synced: number, remaining: number): Message {
	const sent: Message = { key: 'offline.copy.synced', values: { count: synced } };
	const waiting: Message = { key: 'offline.copy.remaining', values: { count: remaining } };
	if (synced > 0 && remaining > 0) {
		return { key: 'offline.copy.syncedAndRemaining', values: { synced: sent, remaining: waiting } };
	}
	if (synced > 0) return sent;
	if (remaining === 0) return { key: 'offline.copy.nothingLeft' };
	return { key: 'offline.copy.nothingSynced' };
}

export const SYNC_NOT_STARTED_MESSAGE: Message = { key: 'offline.copy.syncNotStarted' };

/*
 * German string helpers for callers outside the offline area. The baseline lists this file until
 * every caller uses catalog keys of its own area.
 */

export function formatQueuedOfflineActions(count: number): string {
	if (count === 1) return '1 Offline-Aktion wartet auf Synchronisierung.';
	return `${count} Offline-Aktionen warten auf Synchronisierung.`;
}

export function formatOfflineQueueCount(count: number): string {
	if (count === 0) return 'Keine wartenden Offline-Aktionen.';
	if (count === 1) return '1 Aktion wartet.';
	return `${count} Aktionen warten.`;
}

export function formatQueuedOfflineEntries(count: number): string {
	if (count === 1) return '1 Aktion wartet auf Synchronisierung.';
	return `${count} Aktionen warten auf Synchronisierung.`;
}

function formatSyncedOfflineActions(count: number): string {
	if (count === 1) return '1 Offline-Aktion synchronisiert.';
	return `${count} Offline-Aktionen synchronisiert.`;
}

function formatSyncedActions(count: number, offlineLabel: boolean): string {
	if (offlineLabel) return formatSyncedOfflineActions(count);
	if (count === 1) return '1 Aktion synchronisiert.';
	return `${count} Aktionen synchronisiert.`;
}

function formatRemainingActions(count: number): string {
	if (count === 1) return '1 Aktion wartet weiter.';
	return `${count} Aktionen warten weiter.`;
}

/** Shown when no idempotency key can be made, so the write is not sent unprotected. */
export function keyUnavailableMessage(
	subject: string,
	verb: 'gespeichert' | 'gesendet' | 'erstellt' | 'widerrufen',
): string {
	return `${subject} konnte nicht sicher ${verb} werden. Versuche es erneut.`;
}

/** Shown after a successful offline enqueue (du-form, the app addresses one person). */
export const OFFLINE_SAVED_NOTICE =
	'Offline gespeichert. Wird synchronisiert, sobald du wieder online bist.';

export function formatManualOfflineSyncResult(
	synced: number,
	remaining: number,
	options?: { offlineLabel?: boolean },
): string {
	if (synced > 0 && remaining > 0) {
		return `${formatSyncedActions(synced, options?.offlineLabel ?? true)} ${formatRemainingActions(
			remaining,
		)}`;
	}
	if (synced > 0) return formatSyncedActions(synced, options?.offlineLabel ?? true);
	if (remaining === 0) return 'Keine wartenden Aktionen mehr.';
	return 'Noch nichts synchronisiert. Die Aktionen bleiben sicher gespeichert.';
}

export function getOfflineSyncFailureMessage(): string {
	return 'Synchronisierung konnte nicht gestartet werden. Prüfe deine Verbindung; die Aktionen bleiben gespeichert.';
}

/** Shown when enqueueing a new offline action fails because storage is blocked (private mode, quota, ...). */
export const OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE =
	'Offline-Speicher ist blockiert. Lass den Entwurf offen und versuche es später erneut.';

/** Shown after a successful offline enqueue when clearing the now-stale local draft fails. */
export const OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE =
	'Offline gespeichert, aber der alte Entwurf konnte nicht entfernt werden. Prüfe die Offline-Warteschlange.';

/** Shown when a queued entry that is being edited was synced (or discarded) in the meantime. */
export const QUEUE_EDIT_ALREADY_SENT_MESSAGE =
	'Der Eintrag wurde inzwischen schon gesendet – bitte prüfe die Liste.';

/** Shown after a successful online save when clearing the now-stale local draft fails. */
export const DRAFT_CLEANUP_FAILED_MESSAGE =
	'Gespeichert, aber der alte Offline-Entwurf konnte nicht entfernt werden.';

/** Actions that sync will not retry on its own: the person has to look at them first. */
export function formatOfflineReviewNeeded(count: number): string {
	if (count === 1) return '1 Aktion braucht deine Prüfung.';
	return `${count} Aktionen brauchen deine Prüfung.`;
}

/** Shown when this browser can hold the queue but never replay it (no Web Locks). */
export const OFFLINE_REPLAY_UNSUPPORTED_NOTICE =
	'Dieser Browser kann die Warteschlange hier nicht senden. Öffne die App über https in einer aktuellen Browser-Version, damit die Aktionen übertragen werden.';
