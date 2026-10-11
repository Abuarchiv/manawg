'use client';

import type { StoredIdentity } from '@/core/auth/identity';
import { subscribeOnline } from '@/core/hooks/use-online-status';
import { captureException } from '@/core/infra/capture-client';
import { countOfflineActions, syncOfflineActions } from '@/core/offline/offline-client';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { type RefObject, useCallback, useEffect, useRef } from 'react';

/**
 * Replays this member's queued offline actions every 60 s while visible. The
 * shared syncAbortRef lets an auth change cancel a running replay.
 */
export function useOfflineAutoSync({
	shareCode,
	identity,
	accountReady,
	syncAbortRef,
}: {
	shareCode: string;
	identity: StoredIdentity | null;
	accountReady: boolean;
	syncAbortRef: RefObject<AbortController | null>;
}): (force?: boolean) => Promise<void> {
	const syncingRef = useRef(false);

	// `force` skips the retry backoff; the online event uses it because the backoff was built
	// up while the device had no connection.
	const sync = useCallback(
		async (force = false) => {
			if (
				!accountReady ||
				(typeof navigator !== 'undefined' && navigator.onLine === false) ||
				!identity ||
				syncingRef.current ||
				countOfflineActions(shareCode, { memberId: identity.memberId }) === 0
			) {
				return;
			}
			const controller = syncAbortRef.current ?? new AbortController();
			syncAbortRef.current = controller;
			syncingRef.current = true;
			try {
				await syncOfflineActions(shareCode, {
					memberId: identity.memberId,
					signal: controller.signal,
					force,
				});
			} catch (err) {
				// Automatic sync retries on the next app event or interval.
				captureException(err, { action: 'syncOfflineActions' });
			} finally {
				syncingRef.current = false;
			}
		},
		[accountReady, identity, shareCode, syncAbortRef],
	);

	useVisibilityPausedInterval(() => void sync(), identity && accountReady ? 60_000 : null);

	return sync;
}

/**
 * Sync on online/focus events in addition to the paused interval. These
 * listeners are re-registered when `sync` changes (which happens when identity
 * or the share code change), so the cleanup always removes the listeners
 * bound to the current closure.
 */
export function useSyncOnFocusAndOnline(
	sync: (force?: boolean) => Promise<void>,
	identity: StoredIdentity | null,
	accountReady: boolean,
): void {
	useEffect(() => {
		if (!identity || !accountReady) return;
		void sync();
		const unsubscribeOnline = subscribeOnline(() => void sync(true));
		const onFocus = () => void sync();
		window.addEventListener('focus', onFocus);
		return () => {
			unsubscribeOnline();
			window.removeEventListener('focus', onFocus);
		};
	}, [accountReady, identity, sync]);
}
