'use client';

import { captureException } from '@/core/infra/observability';
import { countOfflineActions, syncOfflineActions } from '@/lib/wg/offline-client';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseOfflineQueueSyncOptions {
	shareCode: string;
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
 * Flushes on `online` and refreshes the count on `manawg:offline-queue`, the
 * event the offline client dispatches whenever the queue changes.
 *
 * Extracted from four pages (ausgaben, einkauf, putzen, pinnwand) that each
 * carried a character-identical copy — except that only ausgaben cancelled its
 * in-flight sync on unmount. That guard is kept here for all of them: without
 * it, a sync resolving after navigation calls setState on an unmounted page.
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

	const refreshCount = useCallback((): void => {
		setQueuedCount(countOfflineActions(shareCode, { memberId }));
	}, [shareCode, memberId]);

	// Held in a ref so a page can pass an inline closure without the listeners
	// being torn down and re-added on every render.
	const onSyncedRef = useRef(onSynced);
	onSyncedRef.current = onSynced;

	useEffect(() => {
		let active = true;
		const updateCount = (): void => {
			if (!active) return;
			setQueuedCount(countOfflineActions(shareCode, { memberId }));
		};
		updateCount();

		const sync = (): void => {
			syncOfflineActions(shareCode, { memberId })
				.then((synced) => {
					if (!active) return;
					updateCount();
					if (synced > 0) onSyncedRef.current();
				})
				.catch((err) => captureException(err, { action: 'syncOfflineActions', page }));
		};

		window.addEventListener('online', sync);
		window.addEventListener('manawg:offline-queue', updateCount);
		return () => {
			active = false;
			window.removeEventListener('online', sync);
			window.removeEventListener('manawg:offline-queue', updateCount);
		};
	}, [shareCode, memberId, page]);

	return { queuedCount, refreshCount };
}
