'use client';

import type { SessionMember } from '@/core/auth/local-account';
import { captureException } from '@/core/infra/capture-client';
import { subscribeOnline } from '@/core/hooks/use-online-status';
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
	identity: SessionMember | null;
	accountReady: boolean;
	syncAbortRef: RefObject<AbortController | null>;
}): (force?: boolean) => Promise<void> {
	const syncingRef = useRef(false);

	const sync = useCallback(
		async (force = false) => {
			if (
				// Without a connection every attempt fails with status 0; the online event triggers the replay.
				(typeof navigator !== 'undefined' && navigator.onLine === false) ||
				!accountReady ||
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
				captureException(err, { action: 'offlineAutoSync' });
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
	identity: SessionMember | null,
	accountReady: boolean,
): void {
	useEffect(() => {
		if (!identity || !accountReady) return;
		void sync();
		// Coming back online must not wait out a backoff that only grew while offline.
		const unsubscribeOnline = subscribeOnline(() => void sync(true));
		const onFocus = () => void sync();
		window.addEventListener('focus', onFocus);
		return () => {
			unsubscribeOnline();
			window.removeEventListener('focus', onFocus);
		};
	}, [accountReady, identity, sync]);
}
