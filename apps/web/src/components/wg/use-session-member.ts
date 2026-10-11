'use client';

import { type SessionMember, rememberWg } from '@/core/auth/local-account';
import { isSessionExpired } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { adoptLocalAccount } from '@/core/offline/offline-client';
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useState,
} from 'react';
import type { WgSummary } from './WgContextProvider';

/**
 * Resolves the signed-in Supabase user to this WG's member: hydration and the /api/wg/[code] member
 * lookup. The member always comes from the server (the WG layout, then the lookup); nothing about
 * it is persisted. The session cookies are HttpOnly, so there is no auth listener: the lookup runs
 * on mount and whenever the tab becomes visible again, and a 401 `auth_required` ends the session.
 */
export function useSessionMember({
	wg,
	initialIdentity,
	sessionless,
	encodedShareCode,
	authGenerationRef,
	authUserIdRef,
	syncAbortRef,
	setStateIdentity,
	setIsAdmin,
	setAccountReady,
	setMemberLoaded,
}: {
	wg: WgSummary;
	initialIdentity: SessionMember | undefined;
	sessionless: boolean;
	encodedShareCode: string;
	authGenerationRef: RefObject<number>;
	authUserIdRef: RefObject<string | null>;
	syncAbortRef: RefObject<AbortController | null>;
	setStateIdentity: Dispatch<SetStateAction<SessionMember | null>>;
	setIsAdmin: (isAdmin: boolean) => void;
	setAccountReady: (accountReady: boolean) => void;
	setMemberLoaded: (memberLoaded: boolean) => void;
}) {
	const [hydrated, setHydrated] = useState(false);
	const [memberLoadError, setMemberLoadError] = useState(false);
	// The Supabase session is gone (sign-out, expired refresh token): not the same as "not a member".
	const [sessionEnded, setSessionEnded] = useState(false);

	useEffect(() => {
		// The server already verified this member (SSR); remember the account for the offline page.
		if (initialIdentity?.authUserId) void adoptLocalAccount(initialIdentity.authUserId);
		// A sessionless WG (the database-free Playwright build) has no Supabase
		// session by design; the fixture member is the member.
		if (sessionless) {
			if (initialIdentity) {
				setStateIdentity(initialIdentity);
				setAccountReady(true);
			}
			setMemberLoaded(true);
		}
		setHydrated(true);
		rememberWg({
			code: wg.shareCode,
			name: wg.name,
			lastVisitedAt: Date.now(),
			authUserId: initialIdentity?.authUserId,
		});
	}, [
		initialIdentity,
		sessionless,
		setAccountReady,
		setMemberLoaded,
		setStateIdentity,
		wg.shareCode,
		wg.name,
	]);

	const loadSessionMember = useCallback(
		async (authUserId: string | null, generation: number, keepCurrentContext = false) => {
			if (!keepCurrentContext) setMemberLoaded(false);
			setMemberLoadError(false);
			const res = await apiFetch<{
				currentMember?: { memberId: string; name: string; authUserId?: string };
			}>(`/api/wg/${encodedShareCode}`);
			if (generation !== authGenerationRef.current) return;
			const member = res.ok ? res.data.currentMember : undefined;
			if (member) {
				// The server names the account behind the cookie, which may have changed in another tab.
				const accountId = member.authUserId ?? authUserId ?? undefined;
				setSessionEnded(false);
				const nextIdentity: SessionMember = {
					memberId: member.memberId,
					name: member.name,
					...(accountId ? { authUserId: accountId } : {}),
				};
				authUserIdRef.current = accountId ?? null;
				if (accountId) void adoptLocalAccount(accountId);
				// Keep the same object when nothing changed: a new identity re-runs
				// refreshMembers and every page fetch keyed on it.
				setStateIdentity((prev) =>
					prev &&
					prev.memberId === nextIdentity.memberId &&
					prev.name === nextIdentity.name &&
					prev.authUserId === nextIdentity.authUserId
						? prev
						: nextIdentity,
				);
				setAccountReady(true);
				setMemberLoaded(true);
				return;
			}

			// A transient failure keeps the member the server verified when the WG layout rendered.
			if (
				!res.ok &&
				(res.status === 0 || res.status === 429 || res.status >= 500) &&
				authUserId !== null &&
				initialIdentity?.authUserId === authUserId
			) {
				setStateIdentity((prev) => prev ?? initialIdentity);
				setAccountReady(true);
				setMemberLoaded(true);
				return;
			}
			if (!res.ok && res.status === 401 && isSessionExpired(res.error)) {
				authUserIdRef.current = null;
				syncAbortRef.current?.abort();
				syncAbortRef.current = null;
				setSessionEnded(true);
			}
			setStateIdentity(null);
			setIsAdmin(false);
			setAccountReady(false);
			setMemberLoadError(!res.ok && (res.status === 0 || res.status === 429 || res.status >= 500));
			setMemberLoaded(true);
		},
		[
			authGenerationRef,
			authUserIdRef,
			encodedShareCode,
			initialIdentity,
			setAccountReady,
			setIsAdmin,
			setMemberLoaded,
			setStateIdentity,
			syncAbortRef,
		],
	);

	useEffect(() => {
		if (!hydrated || sessionless) return;
		let revalidating = false;
		const revalidate = () => {
			if (revalidating) return;
			revalidating = true;
			void loadSessionMember(authUserIdRef.current, authGenerationRef.current, true).finally(() => {
				revalidating = false;
			});
		};
		revalidate();
		// Sign-out or an account switch in another tab shows up on the next lookup.
		const onVisible = () => {
			if (document.visibilityState === 'visible') revalidate();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			authGenerationRef.current += 1;
			syncAbortRef.current?.abort();
			syncAbortRef.current = null;
		};
	}, [authGenerationRef, authUserIdRef, hydrated, loadSessionMember, sessionless, syncAbortRef]);

	return { hydrated, memberLoadError, sessionEnded, loadSessionMember };
}
