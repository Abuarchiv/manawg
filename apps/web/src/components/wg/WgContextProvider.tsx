'use client';

import { IdentityPicker } from '@/components/wg/IdentityPicker';
import { apiFetch } from '@/core/infra/api-client';
import { countOfflineActions, syncOfflineActions } from '@/core/offline/offline-client';
import {
	type StoredIdentity,
	clearIdentity,
	getIdentity,
	rememberWg,
	setIdentity,
} from '@manawg/shared/lib/identity';
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
	children: ReactNode;
}

export function WgContextProvider({ wg, members: initialMembers, children }: Props) {
	const [members, setMembers] = useState<Member[]>(initialMembers);
	const [isAdmin, setIsAdmin] = useState(false);
	const [identity, setStateIdentity] = useState<StoredIdentity | null>(null);
	const [hydrated, setHydrated] = useState(false);
	const syncingRef = useRef(false);
	const encodedShareCode = encodeURIComponent(wg.shareCode);

	useEffect(() => {
		const stored = getIdentity(wg.id);
		setStateIdentity(stored);
		setHydrated(true);
		rememberWg({ code: wg.shareCode, name: wg.name, lastVisitedAt: Date.now() });
	}, [wg.id, wg.shareCode, wg.name]);

	// Self-heal: identities stored before MEMBER_SESSION_SECRET / the token
	// flow existed (or picked via "select existing member", which has no
	// token to hand over) have no memberToken and stay "legacy" — fine for
	// everyday actions, but blocked from admin-gated mutations (WG
	// delete/rename). GET /api/wg/[code] always returns the caller's own
	// current token, so silently backfill it once per missing-token session.
	useEffect(() => {
		if (!identity || identity.memberToken) return;
		let cancelled = false;
		const heal = async () => {
			const res = await apiFetch<{
				currentMember?: { memberId: string; memberToken?: string | null };
			}>(`/api/wg/${encodedShareCode}`, { memberId: identity.memberId });
			if (cancelled || !res.ok) return;
			const token = res.data.currentMember?.memberToken;
			if (!token || res.data.currentMember?.memberId !== identity.memberId) return;
			const healed: StoredIdentity = { ...identity, memberToken: token };
			setIdentity(wg.id, healed);
			setStateIdentity(healed);
		};
		void heal();
		return () => {
			cancelled = true;
		};
	}, [identity, wg.id, encodedShareCode]);

	const refreshMembers = useCallback(
		async (memberIdOverride?: string) => {
			const memberId = memberIdOverride ?? identity?.memberId;
			if (!memberId) return;
			try {
				const res = await apiFetch<{
					members: Array<Member & { active?: boolean }>;
					viewerIsAdmin?: boolean;
				}>(`/api/wg/${encodedShareCode}/members`, { memberId });
				// Normalize defensively: an omitted flag (e.g. E2E fixtures) means active.
				if (res.ok) {
					setMembers(res.data.members.map((m) => ({ ...m, active: m.active !== false })));
					setIsAdmin(res.data.viewerIsAdmin === true);
				} else if (
					res.status === 401 &&
					(res.error === 'not_a_member' ||
						res.error === 'member_id_invalid' ||
						res.error === 'member_id_required')
				) {
					clearIdentity(wg.id);
					setStateIdentity(null);
				}
			} catch {
				// Network blip — ignore; next refresh will retry.
			}
		},
		[encodedShareCode, identity?.memberId, wg.id],
	);

	function onPicked(picked: StoredIdentity): void {
		setStateIdentity(picked);
	}

	const value = useMemo<WgContextValue | null>(() => {
		if (!identity) return null;
		return { wg, members, identity, refreshMembers, isAdmin };
	}, [wg, members, identity, refreshMembers, isAdmin]);

	useEffect(() => {
		if (!identity) return;
		void refreshMembers(identity.memberId);
	}, [identity, refreshMembers]);

	useEffect(() => {
		if (!identity) return;
		const sync = async () => {
			if (
				syncingRef.current ||
				countOfflineActions(wg.shareCode, { memberId: identity.memberId }) === 0
			) {
				return;
			}
			syncingRef.current = true;
			try {
				await syncOfflineActions(wg.shareCode, { memberId: identity.memberId });
			} catch {
				// Automatic sync retries on the next app event or interval.
			} finally {
				syncingRef.current = false;
			}
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') void sync();
		};
		void sync();
		const interval = window.setInterval(() => void sync(), 60_000);
		window.addEventListener('online', sync);
		window.addEventListener('focus', sync);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('online', sync);
			window.removeEventListener('focus', sync);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, [identity, wg.shareCode]);

	if (!hydrated) {
		// Static skeleton shell instead of null: the SSR/first-paint output keeps
		// the document structure (<main> landmark, app background) while the
		// identity is read from localStorage. Fully static markup — no dynamic
		// values — so hydration cannot mismatch.
		return (
			<div className="min-h-svh bg-[var(--bg-base)]" aria-busy="true">
				<main id="main" tabIndex={-1} className="app-page-enter focus:outline-none">
					<div className="mx-auto w-full max-w-3xl px-3 pt-6 sm:px-4" aria-label="Wird geladen">
						<div className="h-7 w-40 animate-pulse rounded-md bg-[var(--surface)]" />
						<div className="mt-4 h-24 animate-pulse rounded-2xl bg-[var(--surface)]" />
						<div className="mt-4 h-24 animate-pulse rounded-2xl bg-[var(--surface)]" />
					</div>
				</main>
			</div>
		);
	}

	if (!identity) {
		return (
			<IdentityPicker
				wgId={wg.id}
				wgShareCode={wg.shareCode}
				wgName={wg.name}
				members={members.filter((m) => m.active)}
				onPicked={onPicked}
			/>
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
