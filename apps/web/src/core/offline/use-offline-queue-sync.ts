'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeOnline } from '@/core/hooks/use-online-status';
import { captureException } from '@/core/infra/capture-client';
import {
	countOfflineActions,
	getSyncedCountForWg,
	OFFLINE_SYNCED_EVENT,
	subscribeOfflineQueueChanges,
	syncOfflineActions,
} from './offline-client';

interface UseOfflineQueueSyncOptions {
	/** `null` turns the hook off: no listeners, a count of 0. */
	shareCode: string | null;
	memberId: string;
	/** Page name, used only to tag sync failures in observability. */
	page: string;
	/**
	 * Called after a sync actually flushed something, so the page can reload the
	 * list it just pushed changes for. Not called when the queue was empty.
	 */
	onSynced: () => void;
}

/**
 * Keeps the offline-action queue in sync with the server and reports how many
 * actions are still waiting.
 *
 * Flushes when the connection comes back, refreshes the count on
 * `manawg:offline-queue` (the event the offline client dispatches whenever the
 * queue changes), and calls `onSynced` on `manawg:offline-synced`, the event a
 * sync dispatches on success regardless of what triggered it. A flush started
 * elsewhere (e.g. the "Jetzt senden" button in `OfflineBanner`) therefore
 * reloads the page's data too.
 *
 * A sync resolving after unmount is ignored, so it never sets state on a page
 * the user already left.
 */
interface OfflineQueueSync {
	/** How many actions are waiting to be sent. */
	queuedCount: number;
	/**
	 * Re-read the count from storage. Pages call this after enqueueing or
	 * dropping an action themselves, since that does not raise the queue event.
	 */
	refreshCount: () => void;
}

export function useOfflineQueueSync({
	shareCode,
	memberId,
	page,
	onSynced,
}: UseOfflineQueueSyncOptions): OfflineQueueSync {
	const [queuedCount, setQueuedCount] = useState(0);
	// `refreshCount` is handed to pages, which call it from their own `.then()`
	// handlers after a sync — possibly long after this component unmounted.
	const mountedRef = useRef(true);

	const refreshCount = useCallback((): void => {
		if (!mountedRef.current || shareCode === null) return;
		setQueuedCount(countOfflineActions(shareCode, { memberId }));
	}, [shareCode, memberId]);

	// Held in a ref so a page can pass an inline closure without the listeners
	// being torn down and re-added on every render.
	const onSyncedRef = useRef(onSynced);
	onSyncedRef.current = onSynced;

	// `page` only tags captured sync failures. Keeping it in a ref keeps the
	// listeners below alive across in-WG navigation instead of tearing them
	// down and re-adding them on every page change.
	const pageRef = useRef(page);
	pageRef.current = page;

	useEffect(() => {
		mountedRef.current = true;
		if (shareCode === null) {
			return () => {
				mountedRef.current = false;
			};
		}
		let active = true;
		const updateCount = (): void => {
			if (!active) return;
			setQueuedCount(countOfflineActions(shareCode, { memberId }));
		};
		updateCount();

		// Only updates the count here: `onSynced` fires from the
		// `manawg:offline-synced` listener below, which `syncOfflineActions`
		// dispatches on success regardless of caller. Calling it here too would
		// double-fire it for this hook's own reconnect-triggered syncs.
		const sync = (): void => {
			syncOfflineActions(shareCode, { memberId, force: true })
				.then(() => {
					if (!active) return;
					updateCount();
				})
				.catch((err) =>
					captureException(err, { action: 'syncOfflineActions', page: pageRef.current }),
				);
		};
		const onExternalSync = (event: Event): void => {
			if (!active) return;
			updateCount();
			if (getSyncedCountForWg(event, shareCode) > 0) onSyncedRef.current();
		};

		const unsubscribeOnline = subscribeOnline(sync);
		const unsubscribeQueueChanges = subscribeOfflineQueueChanges(updateCount);
		window.addEventListener(OFFLINE_SYNCED_EVENT, onExternalSync);
		return () => {
			active = false;
			mountedRef.current = false;
			unsubscribeOnline();
			unsubscribeQueueChanges();
			window.removeEventListener(OFFLINE_SYNCED_EVENT, onExternalSync);
		};
	}, [shareCode, memberId]);

	return { queuedCount, refreshCount };
}
