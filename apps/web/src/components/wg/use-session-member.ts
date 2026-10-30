'use client';

import { type Dispatch, type RefObject, useCallback, useEffect, useState } from 'react';
import { rememberWg, type SessionMember } from '@/core/auth/local-account';
import { subscribeVisibility } from '@/core/hooks/use-online-status';
import { isSessionExpired } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { adoptLocalAccount } from '@/core/offline/offline-client';
import { safeLocalStorage } from '@/core/utils/browser';
import type { WgSummary } from './WgContextProvider';
import type { WgAuthRef, WgSessionAction } from './wg-session-state';

const LOCAL_ACCOUNT_KEY = 'manawg_account';

export function isAccountStorageChange(
	event: Pick<StorageEvent, 'key' | 'oldValue' | 'newValue' | 'storageArea'>,
	currentUserId: string | null,
	storage: Storage,
): boolean {
	if (event.storageArea !== storage) return false;
	let storedUserId: string | null;
	try {
		storedUserId = storage.getItem(LOCAL_ACCOUNT_KEY);
	} catch {
		return false;
	}
	if (event.key === null) return currentUserId !== null && storedUserId === null;
	return (
		event.key === LOCAL_ACCOUNT_KEY &&
		event.oldValue !== event.newValue &&
		event.newValue === storedUserId &&
		event.newValue !== currentUserId
	);
}

/**
 * Resolves the signed-in Supabase user to this WG's member: hydration and the /api/wg/[code] member
 * lookup. The member always comes from the server (the WG layout, then the lookup); nothing about
 * it is persisted. The session cookies are HttpOnly, so there is no auth listener: the lookup runs
 * on mount and whenever the tab becomes visible again, and a 401 `auth_required` ends the session.
 */
export function useSessionMember({
	wg,
	initialIdentity,
	auth,
	dispatch,
}: {
	wg: WgSummary;
	initialIdentity: SessionMember | undefined;
	auth: RefObject<WgAuthRef>;
	dispatch: Dispatch<WgSessionAction>;
}) {
	const [hydrated, setHydrated] = useState(false);
	const encodedShareCode = encodeURIComponent(wg.shareCode);

	useEffect(() => {
		// The server already verified this member (SSR); remember the account for the offline page.
		if (initialIdentity?.authUserId) {
			void adoptLocalAccount(initialIdentity.authUserId);
			rememberWg({
				code: wg.shareCode,
				name: wg.name,
				lastVisitedAt: Date.now(),
				authUserId: initialIdentity.authUserId,
			});
		}
		setHydrated(true);
	}, [initialIdentity, wg.shareCode, wg.name]);

	const loadSessionMember = useCallback(
		async (authUserId: string | null, generation: number, keepCurrentContext = false) => {
			dispatch({ type: 'loading', keepCurrentContext });
			const res = await apiFetch<{
				currentMember?: { memberId: string; name: string; authUserId?: string };
			}>(`/api/wg/${encodedShareCode}`);
			if (generation !== auth.current.generation) return;
			const member = res.ok ? res.data.currentMember : undefined;
			if (member) {
				// The server names the account behind the cookie, which may have changed in another tab.
				const accountId = member.authUserId ?? authUserId ?? undefined;
				auth.current.userId = accountId ?? null;
				if (accountId) {
					void adoptLocalAccount(accountId);
					rememberWg({
						code: wg.shareCode,
						name: wg.name,
						lastVisitedAt: Date.now(),
						authUserId: accountId,
					});
				}
				dispatch({
					type: 'member-loaded',
					identity: {
						memberId: member.memberId,
						name: member.name,
						...(accountId ? { authUserId: accountId } : {}),
					},
				});
				return;
			}

			const transient = !res.ok && (res.status === 0 || res.status === 429 || res.status >= 500);
			// A transient failure keeps the member the server verified when the WG layout rendered.
			if (
				transient &&
				initialIdentity &&
				authUserId !== null &&
				initialIdentity.authUserId === authUserId
			) {
				dispatch({ type: 'kept-after-transient-failure', identity: initialIdentity });
				return;
			}
			if (!res.ok && res.status === 401 && isSessionExpired(res.error)) {
				auth.current.userId = null;
				auth.current.syncAbort?.abort();
				auth.current.syncAbort = null;
				dispatch({ type: 'session-ended' });
				return;
			}
			dispatch({ type: 'load-failed', retryable: transient });
		},
		[auth, dispatch, encodedShareCode, initialIdentity, wg.name, wg.shareCode],
	);

	useEffect(() => {
		if (!hydrated) return;
		let revalidating = false;
		let requestId = 0;
		const revalidate = (userId: string | null, keepCurrentContext: boolean): void => {
			if (revalidating) return;
			revalidating = true;
			const currentRequestId = ++requestId;
			void loadSessionMember(userId, auth.current.generation, keepCurrentContext).finally(() => {
				if (requestId === currentRequestId) revalidating = false;
			});
		};
		const onVisible = () => revalidate(auth.current.userId, true);
		const onStorage = (event: StorageEvent): void => {
			const storage = safeLocalStorage();
			if (!storage || !isAccountStorageChange(event, auth.current.userId, storage)) return;
			auth.current.generation += 1;
			auth.current.syncAbort?.abort();
			auth.current.syncAbort = null;
			auth.current.userId = null;
			dispatch({ type: 'member-lost' });
			requestId += 1;
			revalidating = false;
			revalidate(null, false);
		};

		revalidate(auth.current.userId, true);
		// Sign-out or an account switch in another tab shows up on the next lookup.
		const offVisible = subscribeVisibility((visible) => visible && onVisible());
		window.addEventListener('storage', onStorage);
		return () => {
			offVisible();
			window.removeEventListener('storage', onStorage);
			auth.current.generation += 1;
			auth.current.syncAbort?.abort();
			auth.current.syncAbort = null;
		};
	}, [auth, dispatch, hydrated, loadSessionMember]);

	return { hydrated, loadSessionMember };
}
