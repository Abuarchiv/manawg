'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { createSupabaseBrowserClient } from '@/core/auth/client';
import { apiFetch } from '@/core/infra/api-client';
import { captureException } from '@/core/infra/observability';
import { countOfflineActions, syncOfflineActions } from '@/core/offline/offline-client';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { cn } from '@/shared/lib/cn';
import {
	type StoredIdentity,
	clearIdentity,
	getIdentity,
	rememberWg,
	setIdentity,
} from '@/shared/lib/identity';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import type { ReactNode } from 'react';

export interface WgSummary {
	id: string;
	name: string;
	shareCode: string;
	joiningEnabled: boolean;
	shareCodeRotatedAt?: string | Date | null;
}

export interface Member {
	id: string;
	name: string;
	color?: string | null;
	paypalMerchantId?: string | null;
	// false when the member has moved out ("Auszug"). The context always holds
	// the full roster so history and balances keep resolving names; choice UIs
	// (identity picker, dropdowns, chore rotation) filter to active members.
	active: boolean;
}

interface WgContextValue {
	wg: WgSummary;
	members: Member[];
	identity: StoredIdentity;
	refreshMembers: (memberId?: string) => Promise<void>;
	// Whether the caller is the WG admin — UI gating only (deactivate/
	// reactivate buttons, chat admin-delete). Every mutation re-checks
	// server-side, so this being stale/spoofed can't grant real access.
	isAdmin: boolean;
}

const WgContext = createContext<WgContextValue | null>(null);

interface Props {
	wg: WgSummary;
	members: Member[];
	initialIdentity?: StoredIdentity | undefined;
	children: ReactNode;
}

export function WgContextProvider({
	wg,
	members: initialMembers,
	initialIdentity,
	children,
}: Props) {
	const [members, setMembers] = useState<Member[]>(initialMembers);
	const [isAdmin, setIsAdmin] = useState(false);
	const [identity, setStateIdentity] = useState<StoredIdentity | null>(initialIdentity ?? null);
	const [accountReady, setAccountReady] = useState(false);
	const [hydrated, setHydrated] = useState(false);
	const [memberLoaded, setMemberLoaded] = useState(false);
	const [memberLoadError, setMemberLoadError] = useState(false);
	// Consecutive non-auth failures (429, 5xx, network) of the members/admin
	// fetch. Without retries isAdmin would stay false for
	// the whole session and hide every admin action.
	const [membersRefreshFailures, setMembersRefreshFailures] = useState(0);
	const syncingRef = useRef(false);
	const syncAbortRef = useRef<AbortController | null>(null);
	const authUserIdRef = useRef<string | null>(initialIdentity?.authUserId ?? null);
	const authGenerationRef = useRef(0);
	const encodedShareCode = encodeURIComponent(wg.shareCode);

	useEffect(() => {
		const storedIdentity = getIdentity(wg.id);
		// The database-free Playwright fixture has no Supabase session by design.
		// It only exists in CI and keeps its old local identity setup working.
		const fixtureMode =
			process.env.NEXT_PUBLIC_DB_DOWN === 'true' &&
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE === 'true';
		if (fixtureMode) {
			const fixtureIdentity = storedIdentity ?? initialIdentity;
			if (fixtureIdentity) {
				setStateIdentity(fixtureIdentity);
				setAccountReady(true);
			}
			setMemberLoaded(true);
		}
		setHydrated(true);
		rememberWg({ code: wg.shareCode, name: wg.name, lastVisitedAt: Date.now() });
	}, [initialIdentity, wg.id, wg.shareCode, wg.name]);

	const loadSessionMember = useCallback(
		async (authUserId: string, generation: number, keepCurrentContext = false) => {
			if (!keepCurrentContext) setMemberLoaded(false);
			setMemberLoadError(false);
			const res = await apiFetch<{
				currentMember?: { memberId: string; name: string; memberToken?: string };
			}>(`/api/wg/${encodedShareCode}`);
			if (generation !== authGenerationRef.current) return;
			const member = res.ok ? res.data.currentMember : undefined;
			if (member) {
				const nextIdentity: StoredIdentity = {
					memberId: member.memberId,
					name: member.name,
					authUserId,
					...(member.memberToken ? { memberToken: member.memberToken } : {}),
				};
				setIdentity(wg.id, nextIdentity);
				setStateIdentity(nextIdentity);
				setAccountReady(true);
				setMemberLoaded(true);
				return;
			}

			const cachedIdentity = getIdentity(wg.id);
			if (
				!res.ok &&
				(res.status === 0 || res.status >= 500) &&
				cachedIdentity?.authUserId === authUserId
			) {
				setStateIdentity(cachedIdentity);
				setAccountReady(true);
				setMemberLoaded(true);
				return;
			}
			clearIdentity(wg.id);
			setStateIdentity(null);
			setIsAdmin(false);
			setAccountReady(false);
			setMemberLoadError(!res.ok && (res.status === 0 || res.status >= 500));
			setMemberLoaded(true);
		},
		[encodedShareCode, wg.id],
	);

	useEffect(() => {
		if (!hydrated) return;
		if (
			process.env.NEXT_PUBLIC_DB_DOWN === 'true' &&
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE === 'true'
		) {
			return;
		}
		const supabase = createSupabaseBrowserClient();
		const clearSessionIdentity = () => {
			authGenerationRef.current += 1;
			syncAbortRef.current?.abort();
			syncAbortRef.current = null;
			authUserIdRef.current = null;
			clearIdentity(wg.id);
			setStateIdentity(null);
			setIsAdmin(false);
			setAccountReady(false);
			setMemberLoaded(true);
		};
		const loadForUser = (nextUserId: string) => {
			if (nextUserId !== authUserIdRef.current) {
				authUserIdRef.current = nextUserId;
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
			const generation = authGenerationRef.current;
			window.setTimeout(() => void loadSessionMember(nextUserId, generation, true), 0);
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
		return () => {
			data.subscription.unsubscribe();
			authGenerationRef.current += 1;
			syncAbortRef.current?.abort();
			syncAbortRef.current = null;
		};
	}, [hydrated, loadSessionMember, wg.id]);

	const refreshMembers = useCallback(async () => {
		if (!identity || !accountReady) return;
		const authGeneration = authGenerationRef.current;
		try {
			const res = await apiFetch<{
				members: Array<Member & { active?: boolean }>;
				viewerIsAdmin?: boolean;
			}>(`/api/wg/${encodedShareCode}/members`, {
				memberId: identity.memberId,
				memberToken: identity.memberToken,
			});
			if (authGeneration !== authGenerationRef.current) return;
			// Normalize defensively: an omitted flag (e.g. E2E fixtures) means active.
			if (res.ok) {
				setMembers(res.data.members.map((m) => ({ ...m, active: m.active !== false })));
				setIsAdmin(res.data.viewerIsAdmin === true);
				setMembersRefreshFailures(0);
				return;
			}
			// Keep counting transient failures so the retry backs off (5 s → 60 s).
			if (res.status === 401 && res.error === 'auth_required') {
				window.location.replace(
					`/neu?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
				);
			} else if (
				res.status === 401 &&
				(res.error === 'not_a_member' || res.error === 'member_deactivated')
			) {
				clearIdentity(wg.id);
				setStateIdentity(null);
				setMembersRefreshFailures(0);
			} else if (res.error === 'member_context_changed' && authUserIdRef.current) {
				await loadSessionMember(authUserIdRef.current, authGeneration);
			} else {
				setMembersRefreshFailures((failures) => failures + 1);
			}
		} catch (err) {
			setMembersRefreshFailures((failures) => failures + 1);
			// Network blip — the paused interval/focus listener retries. Log it
			// so silently stale member lists stay diagnosable instead of
			// vanishing into an empty catch block.
			captureException(err, { action: 'refreshMembers', shareCode: encodedShareCode });
		}
	}, [accountReady, encodedShareCode, identity, loadSessionMember, wg.id]);

	const value = useMemo<WgContextValue | null>(() => {
		if (!identity) return null;
		return { wg, members, identity, refreshMembers, isAdmin };
	}, [wg, members, identity, refreshMembers, isAdmin]);

	useEffect(() => {
		if (!identity) return;
		void refreshMembers();
	}, [identity, refreshMembers]);

	// Retry a failed members/admin fetch with backoff and on focus/online, so
	// one transient error does not hide admin actions until a hard reload.
	useEffect(() => {
		if (membersRefreshFailures === 0 || !identity || !accountReady) return;
		const retry = () => void refreshMembers();
		const delayMs = Math.min(60_000, 5_000 * 2 ** (membersRefreshFailures - 1));
		const timer = window.setTimeout(retry, delayMs);
		window.addEventListener('online', retry);
		window.addEventListener('focus', retry);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener('online', retry);
			window.removeEventListener('focus', retry);
		};
	}, [accountReady, identity, membersRefreshFailures, refreshMembers]);

	const sync = useCallback(async () => {
		if (
			!accountReady ||
			!identity ||
			syncingRef.current ||
			countOfflineActions(wg.shareCode, { memberId: identity.memberId }) === 0
		) {
			return;
		}
		const controller = syncAbortRef.current ?? new AbortController();
		syncAbortRef.current = controller;
		syncingRef.current = true;
		try {
			await syncOfflineActions(wg.shareCode, {
				memberId: identity.memberId,
				signal: controller.signal,
			});
		} catch {
			// Automatic sync retries on the next app event or interval.
		} finally {
			syncingRef.current = false;
		}
	}, [accountReady, identity, wg.shareCode]);

	useVisibilityPausedInterval(() => void sync(), identity && accountReady ? 60_000 : null);

	// Sync on online/focus events in addition to the paused interval above.
	// These listeners are re-registered when `sync` changes (which happens when
	// identity or wg.shareCode change), so the cleanup always removes the
	// listeners bound to the current closure.
	useEffect(() => {
		if (!identity || !accountReady) return;
		void sync();
		window.addEventListener('online', sync);
		window.addEventListener('focus', sync);
		return () => {
			window.removeEventListener('online', sync);
			window.removeEventListener('focus', sync);
		};
	}, [accountReady, identity, sync]);

	if (!hydrated || !memberLoaded) {
		// Static skeleton shell instead of null: the SSR/first-paint output keeps
		// the document structure (<main> landmark, app background) while the
		// client hydrates. Fully static markup — no dynamic
		// values — so hydration cannot mismatch.
		return (
			<div className="min-h-svh bg-background" aria-busy="true">
				<main id="main" tabIndex={-1} className="focus:outline-none">
					<div
						className="mx-auto w-full max-w-3xl px-4 pt-6"
						aria-label="Wird geladen"
						// biome-ignore lint/a11y/useSemanticElements: role="status" names the loading region without swapping the wrapper element to <output>.
						role="status"
					>
						<Skeleton className="h-7 w-40" />
						<Skeleton className="mt-4 h-24 rounded-xl" />
						<Skeleton className="mt-4 h-24 rounded-xl" />
					</div>
				</main>
			</div>
		);
	}

	if (memberLoadError) {
		return (
			<main id="main" tabIndex={-1} className="mx-auto max-w-md p-6">
				<Alert variant="destructive">
					<AlertDescription className="text-current">
						Deine WG konnte nicht geladen werden. Bitte versuche es erneut.
					</AlertDescription>
					<Button
						type="button"
						variant="outline"
						size="lg"
						className="mt-3"
						onClick={() => window.location.reload()}
					>
						Erneut versuchen
					</Button>
				</Alert>
			</main>
		);
	}

	if (!identity) {
		return (
			<main id="main" tabIndex={-1} className="mx-auto max-w-md p-6">
				<Alert variant="destructive">
					<AlertDescription className="text-current">
						Deine Mitgliedschaft konnte nicht bestätigt werden.
					</AlertDescription>
					<a
						href={`/neu?next=${encodeURIComponent(`/wg/${wg.shareCode}`)}`}
						className={cn(buttonVariants({ variant: 'link', size: 'lg' }), 'mt-2 px-0')}
					>
						Zurück zu deinen WGs
					</a>
				</Alert>
			</main>
		);
	}

	return <WgContext.Provider value={value}>{children}</WgContext.Provider>;
}

export function useWg(): WgContextValue {
	const ctx = useContext(WgContext);
	if (!ctx) {
		throw new Error('useWg must be used inside <WgContextProvider> with a chosen identity');
	}
	return ctx;
}
