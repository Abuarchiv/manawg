'use client';

import {
	type StoredIdentity,
	clearIdentity,
	getIdentity,
	rememberWg,
	setIdentity,
} from '@/core/auth/identity';
import { isSessionExpired } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { captureException } from '@/core/infra/capture-client';
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
 * Resolves the signed-in Supabase user to this WG's member: hydration (and the
 * stored identity of a sessionless WG), the auth listener, and the
 * /api/wg/[code] member lookup.
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
	initialIdentity: StoredIdentity | undefined;
	sessionless: boolean;
	encodedShareCode: string;
	authGenerationRef: RefObject<number>;
	authUserIdRef: RefObject<string | null>;
	syncAbortRef: RefObject<AbortController | null>;
	setStateIdentity: Dispatch<SetStateAction<StoredIdentity | null>>;
	setIsAdmin: (isAdmin: boolean) => void;
	setAccountReady: (accountReady: boolean) => void;
	setMemberLoaded: (memberLoaded: boolean) => void;
}) {
	const [hydrated, setHydrated] = useState(false);
	const [memberLoadError, setMemberLoadError] = useState(false);
	// The Supabase session is gone (sign-out, expired refresh token): not the same as "not a member".
	const [sessionEnded, setSessionEnded] = useState(false);

	useEffect(() => {
		const storedIdentity = getIdentity(wg.id);
		// The server already verified this member (SSR); cache it so the transient-error
		// fallback in loadSessionMember has something to fall back to.
		if (initialIdentity?.authUserId && storedIdentity?.authUserId !== initialIdentity.authUserId) {
			setIdentity(wg.id, initialIdentity);
		}
		// A sessionless WG (the database-free Playwright build) has no Supabase
		// session by design; the locally stored identity is the member.
		if (sessionless) {
			const localIdentity = storedIdentity ?? initialIdentity;
			if (localIdentity) {
				setStateIdentity(localIdentity);
				setAccountReady(true);
			}
			setMemberLoaded(true);
		}
		setHydrated(true);
		rememberWg({ code: wg.shareCode, name: wg.name, lastVisitedAt: Date.now() });
	}, [
		initialIdentity,
		sessionless,
		setAccountReady,
		setMemberLoaded,
		setStateIdentity,
		wg.id,
		wg.shareCode,
		wg.name,
	]);

	const loadSessionMember = useCallback(
		async (authUserId: string, generation: number, keepCurrentContext = false) => {
			if (!keepCurrentContext) setMemberLoaded(false);
			setMemberLoadError(false);
			const res = await apiFetch<{
				currentMember?: { memberId: string; name: string };
			}>(`/api/wg/${encodedShareCode}`);
			if (generation !== authGenerationRef.current) return;
			const member = res.ok ? res.data.currentMember : undefined;
			if (member) {
				setSessionEnded(false);
				const nextIdentity: StoredIdentity = {
					memberId: member.memberId,
					name: member.name,
					authUserId,
				};
				setIdentity(wg.id, nextIdentity);
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

			const cachedIdentity = getIdentity(wg.id);
			if (
				!res.ok &&
				(res.status === 0 || res.status === 429 || res.status >= 500) &&
				cachedIdentity?.authUserId === authUserId
			) {
				setStateIdentity(cachedIdentity);
				setAccountReady(true);
				setMemberLoaded(true);
				return;
			}
			if (!res.ok && res.status === 401 && isSessionExpired(res.error)) setSessionEnded(true);
			clearIdentity(wg.id);
			setStateIdentity(null);
			setIsAdmin(false);
			setAccountReady(false);
			setMemberLoadError(!res.ok && (res.status === 0 || res.status === 429 || res.status >= 500));
			setMemberLoaded(true);
		},
		[
			authGenerationRef,
			encodedShareCode,
			setAccountReady,
			setIsAdmin,
			setMemberLoaded,
			setStateIdentity,
			wg.id,
		],
	);

	useEffect(() => {
		if (!hydrated) return;
		if (sessionless) return;
		let cancelled = false;
		let unsubscribe: (() => void) | undefined;
		void import('@/core/auth/client').then(({ createSupabaseBrowserClient }) => {
			if (cancelled) return;
			const supabase = createSupabaseBrowserClient();
			const clearSessionIdentity = () => {
				authGenerationRef.current += 1;
				syncAbortRef.current?.abort();
				syncAbortRef.current = null;
				authUserIdRef.current = null;
				setSessionEnded(true);
				clearIdentity(wg.id);
				setStateIdentity(null);
				setIsAdmin(false);
				setAccountReady(false);
				setMemberLoaded(true);
			};
			let revalidating = false;
			const loadForUser = (nextUserId: string) => {
				if (nextUserId !== authUserIdRef.current) {
					authUserIdRef.current = nextUserId;
					setSessionEnded(false);
					const generation = ++authGenerationRef.current;
					syncAbortRef.current?.abort();
					syncAbortRef.current = null;
					setIsAdmin(false);
					setAccountReady(false);
					setMemberLoaded(false);
					if (getIdentity(wg.id)?.authUserId !== nextUserId) {
						clearIdentity(wg.id);
						setStateIdentity(null);
					}
					window.setTimeout(() => void loadSessionMember(nextUserId, generation), 0);
					return;
				}
				// getSession and INITIAL_SESSION both land here on mount; one revalidation is enough.
				if (revalidating) return;
				revalidating = true;
				const generation = authGenerationRef.current;
				window.setTimeout(() => {
					void loadSessionMember(nextUserId, generation, true).finally(() => {
						revalidating = false;
					});
				}, 0);
			};
			const { data } = supabase.auth.onAuthStateChange((event, session) => {
				const nextUserId = session?.user.id ?? null;
				if (event === 'SIGNED_OUT' || !nextUserId) {
					clearSessionIdentity();
					return;
				}
				if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') loadForUser(nextUserId);
			});
			const generation = authGenerationRef.current;
			void supabase.auth.getSession().then(({ data: sessionData, error }) => {
				if (error || generation !== authGenerationRef.current) return;
				const userId = sessionData.session?.user.id;
				if (userId) loadForUser(userId);
				else clearSessionIdentity();
			});
			unsubscribe = () => data.subscription.unsubscribe();
		}).catch((err) => captureException(err, { action: 'sessionMemberAuthInit' }));
		return () => {
			cancelled = true;
			unsubscribe?.();
			authGenerationRef.current += 1;
			syncAbortRef.current?.abort();
			syncAbortRef.current = null;
		};
	}, [
		authGenerationRef,
		authUserIdRef,
		hydrated,
		loadSessionMember,
		sessionless,
		setAccountReady,
		setIsAdmin,
		setMemberLoaded,
		setStateIdentity,
		syncAbortRef,
		wg.id,
	]);

	return { hydrated, memberLoadError, sessionEnded, loadSessionMember };
}
