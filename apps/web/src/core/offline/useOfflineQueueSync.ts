'use client';

import { captureException } from '@/core/infra/capture-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { countOfflineActions, getSyncedCountForWg, syncOfflineActions } from './offline-client';

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
 * Flushes on `online`, refreshes the count on `manawg:offline-queue` (the
 * event the offline client dispatches whenever the queue changes), and also
 * calls `onSynced` on `manawg:offline-synced` — the event a sync dispatches
 * on success regardless of what triggered it. Without that second listener,
 * a flush triggered by the "Jetzt senden" button in `OfflineBanner` (which
 * calls `syncOfflineActions` directly, not through this hook's own `sync`)
 * would leave the page showing pre-sync data until a manual reload, even
 * though the server already has the change.
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
	// `refreshCount` is handed to pages, which call it from their own `.then()`
	// handlers after a sync — possibly long after this component unmounted.
	const mountedRef = useRef(true);

	const refreshCount = useCallback((): void => {
		if (!mountedRef.current) return;
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
		let active = true;
		mountedRef.current = true;
		const updateCount = (): void => {
			if (!active) return;
			setQueuedCount(countOfflineActions(shareCode, { memberId }));
		};
		updateCount();

		// Only updates the count here — `onSynced` fires from the
		// `manawg:offline-synced` listener below, which `syncOfflineActions`
		// dispatches on success regardless of caller. Calling it here too would
		// double-fire it for this hook's own `online`-triggered syncs, since
		// that dispatch reaches this same listener.
		const sync = (): void => {
			syncOfflineActions(shareCode, { memberId })
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

		window.addEventListener('online', sync);
		window.addEventListener('manawg:offline-queue', updateCount);
		window.addEventListener('manawg:offline-synced', onExternalSync);
		return () => {
			active = false;
			mountedRef.current = false;
			window.removeEventListener('online', sync);
			window.removeEventListener('manawg:offline-queue', updateCount);
			window.removeEventListener('manawg:offline-synced', onExternalSync);
		};
	}, [shareCode, memberId]);

	return { queuedCount, refreshCount };
}
