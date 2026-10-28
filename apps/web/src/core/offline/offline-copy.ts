import type { Message } from '@/shared/i18n/message';

/** Count of waiting actions in the settings queue. */
export function offlineQueueCountMessage(count: number): Message {
	return { key: 'offline.copy.queueCount', values: { count } };
}

/** Result of a manual sync: what was sent and what still waits. */
export function manualSyncResultMessage(
	synced: number,
	remaining: number,
	options?: { offlineLabel?: boolean },
): Message {
	const sent: Message = {
		key: options?.offlineLabel ? 'offline.copy.syncedOffline' : 'offline.copy.synced',
		values: { count: synced },
	};
	const waiting: Message = { key: 'offline.copy.remaining', values: { count: remaining } };
	if (synced > 0 && remaining > 0) {
		return { key: 'offline.copy.syncedAndRemaining', values: { synced: sent, remaining: waiting } };
	}
	if (synced > 0) return sent;
	if (remaining === 0) return { key: 'offline.copy.nothingLeft' };
	return { key: 'offline.copy.nothingSynced' };
}

export const SYNC_NOT_STARTED_MESSAGE: Message = { key: 'offline.copy.syncNotStarted' };

/** Banner line while actions wait for the sync. */
export function queuedOfflineActionsMessage(count: number): Message {
	return { key: 'offline.copy.queued', values: { count } };
}

/** Actions that sync will not retry on its own: the person has to look at them first. */
export function offlineReviewNeededMessage(count: number): Message {
	return { key: 'offline.copy.reviewNeeded', values: { count } };
}

/** Shown when this browser can hold the queue but never replay it (no Web Locks). */
export const OFFLINE_REPLAY_UNSUPPORTED_MESSAGE: Message = { key: 'offline.copy.replayUnsupported' };
