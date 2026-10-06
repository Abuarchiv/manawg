'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/shared/lib/cn';
import type { StoredIdentity } from '@/shared/lib/identity';
import { createContext, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMembersPolling, useMembersRefresh } from './use-members-refresh';
import { useMembershipLost } from './use-membership-lost';
import { useOfflineAutoSync, useSyncOnFocusAndOnline } from './use-offline-auto-sync';
import { useSessionMember } from './use-session-member';
import { useTabWarmup } from './use-tab-warmup';

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
	/** Server-verified admin flag; only meaningful together with initialIdentity.authUserId. */
	initialIsAdmin?: boolean | undefined;
	children: ReactNode;
}

export function WgContextProvider({
	wg,
	members: initialMembers,
	initialIdentity,
	initialIsAdmin,
	children,
}: Props) {
	// The WG layout resolved the Supabase session and membership on the server
	// (authUserId is only set there). Start ready instead of waiting for
	// getSession -> /api/wg/[code]; the auth listener still revalidates in the
	// background and clears everything on sign-out.
	const serverVerified = Boolean(initialIdentity?.authUserId);
	const [members, setMembers] = useState<Member[]>(initialMembers);
	const [isAdmin, setIsAdmin] = useState(serverVerified && initialIsAdmin === true);
	const [identity, setStateIdentity] = useState<StoredIdentity | null>(initialIdentity ?? null);
	const [accountReady, setAccountReady] = useState(serverVerified);
	const [memberLoaded, setMemberLoaded] = useState(serverVerified);
	const syncAbortRef = useRef<AbortController | null>(null);
	const authUserIdRef = useRef<string | null>(initialIdentity?.authUserId ?? null);
	const authGenerationRef = useRef(0);
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const identitySetters = { setStateIdentity, setIsAdmin, setAccountReady, setMemberLoaded };

	const { hydrated, memberLoadError, loadSessionMember } = useSessionMember({
		wg,
		initialIdentity,
		encodedShareCode,
		authGenerationRef,
		authUserIdRef,
		syncAbortRef,
		...identitySetters,
	});

	useMembershipLost({
		wgId: wg.id,
		encodedShareCode,
		authGenerationRef,
		syncAbortRef,
		...identitySetters,
	});

	const refreshMembers = useMembersRefresh({
		wgId: wg.id,
		encodedShareCode,
		identity,
		accountReady,
		serverVerified,
		authGenerationRef,
		authUserIdRef,
		loadSessionMember,
		setMembers,
		setIsAdmin,
		setStateIdentity,
	});

	const value = useMemo<WgContextValue | null>(() => {
		if (!identity) return null;
		return { wg, members, identity, refreshMembers, isAdmin };
	}, [wg, members, identity, refreshMembers, isAdmin]);

	// Hook order is effect order: the sync interval, the members poll, then the
	// online/focus sync listeners, so shared visibility/online events fire them in that order.
	const sync = useOfflineAutoSync({
		shareCode: wg.shareCode,
		identity,
		accountReady,
		syncAbortRef,
	});
	useMembersPolling(refreshMembers, Boolean(identity && accountReady));
	useSyncOnFocusAndOnline(sync, identity, accountReady);
	useTabWarmup(encodedShareCode, accountReady ? identity?.memberId : undefined);

	// A server-verified session already carries the identity, so the shell and page render
	// in the SSR HTML; only the localStorage path has to wait for the mount effect.
	if (!memberLoaded || (!hydrated && !serverVerified)) {
		// Static skeleton shell instead of null: the SSR/first-paint output keeps
		// the document structure (<main> landmark, app background) while the
		// client hydrates. Fully static markup — no dynamic
		// values — so hydration cannot mismatch.
		return (
			<div className="min-h-svh bg-background" aria-busy="true">
				<main id="main" tabIndex={-1} className="focus:outline-none">
					<div
						className="mx-auto w-full max-w-[var(--app-frame-width)] px-4 pt-6"
						aria-label="Wird geladen"
						// biome-ignore lint/a11y/useSemanticElements: role="status" names the loading region without swapping the wrapper element to <output>.
						role="status"
					>
						<Skeleton className="h-7 w-40 max-w-full" />
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
						Du bist in dieser WG nicht (mehr) Mitglied, z. B. weil du ausgezogen bist oder entfernt
						wurdest.
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
