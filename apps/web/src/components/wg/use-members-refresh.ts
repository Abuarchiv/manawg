'use client';

import { subscribeOnline } from '@/core/hooks/use-online-status';
import { apiFetch } from '@/core/infra/api-client';
import { captureException } from '@/core/infra/capture-client';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { type StoredIdentity, clearIdentity } from '@/shared/lib/identity';
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import type { Member } from './WgContextProvider';

/**
 * Members list and admin flag from /api/wg/[code]/members, refetched when the
 * identity changes and retried with backoff after transient failures.
 */
type MemberRow = Member & { active?: boolean };
type MembersPage = {
	members: MemberRow[];
	viewerIsAdmin?: boolean;
	pagination?: { total: number };
};

const MEMBERS_PAGE_SIZE = 500;
const MEMBERS_MAX_PAGES = 20;

/** The whole roster: moved-out members stay needed for history and balances, so every page is read. */
async function fetchAllMembers(encodedShareCode: string, memberId: string) {
	const members: MemberRow[] = [];
	let first: Awaited<ReturnType<typeof apiFetch<MembersPage>>> | null = null;
	for (let page = 0; page < MEMBERS_MAX_PAGES; page += 1) {
		// The first request is the plain list; only a longer roster needs further pages.
		const query = page === 0 ? '' : `?limit=${MEMBERS_PAGE_SIZE}&offset=${members.length}`;
		const res = await apiFetch<MembersPage>(`/api/wg/${encodedShareCode}/members${query}`, {
			memberId,
		});
		if (!res.ok) return res;
		first ??= res;
		members.push(...res.data.members);
		const total = res.data.pagination?.total ?? members.length;
		if (res.data.members.length === 0 || members.length >= total) break;
	}
	return {
		ok: true as const,
		data: { members, viewerIsAdmin: first?.ok ? first.data.viewerIsAdmin : undefined },
	};
}

export function useMembersRefresh({
	wgId,
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
}: {
	wgId: string;
	encodedShareCode: string;
	identity: StoredIdentity | null;
	accountReady: boolean;
	serverVerified: boolean;
	authGenerationRef: RefObject<number>;
	authUserIdRef: RefObject<string | null>;
	loadSessionMember: (authUserId: string, generation: number) => Promise<void>;
	setMembers: Dispatch<SetStateAction<Member[]>>;
	setIsAdmin: (isAdmin: boolean) => void;
	setStateIdentity: Dispatch<SetStateAction<StoredIdentity | null>>;
}): () => Promise<void> {
	// Consecutive non-auth failures (429, 5xx, network) of the members/admin
	// fetch. Without retries isAdmin would stay false for
	// the whole session and hide every admin action.
	const [membersRefreshFailures, setMembersRefreshFailures] = useState(0);

	const refreshMembers = useCallback(async () => {
		if (!identity || !accountReady) return;
		const authGeneration = authGenerationRef.current;
		try {
			const res = await fetchAllMembers(encodedShareCode, identity.memberId);
			if (authGeneration !== authGenerationRef.current) return;
			// Normalize defensively: an omitted flag (e.g. E2E fixtures) means active.
			if (res.ok) {
				const next = res.data.members.map((m) => ({ ...m, active: m.active !== false }));
				// Polled every 30 s: keep an unchanged list, otherwise every useWg() consumer re-renders for nothing.
				setMembers((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
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
				clearIdentity(wgId);
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
	}, [
		accountReady,
		authGenerationRef,
		authUserIdRef,
		encodedShareCode,
		identity,
		loadSessionMember,
		setIsAdmin,
		setMembers,
		setStateIdentity,
		wgId,
	]);

	// The layout already delivered members/isAdmin for a server-verified session.
	const skipFirstMembersFetch = useRef(serverVerified);
	useEffect(() => {
		if (!identity) return;
		if (skipFirstMembersFetch.current) {
			skipFirstMembersFetch.current = false;
			return;
		}
		void refreshMembers();
	}, [identity, refreshMembers]);

	// Retry a failed members/admin fetch with backoff and on focus/online, so
	// one transient error does not hide admin actions until a hard reload.
	useEffect(() => {
		if (membersRefreshFailures === 0 || !identity || !accountReady) return;
		const retry = () => void refreshMembers();
		const delayMs = Math.min(60_000, 5_000 * 2 ** (membersRefreshFailures - 1));
		const timer = window.setTimeout(retry, delayMs);
		const unsubscribeOnline = subscribeOnline(retry);
		window.addEventListener('focus', retry);
		return () => {
			window.clearTimeout(timer);
			unsubscribeOnline();
			window.removeEventListener('focus', retry);
		};
	}, [accountReady, identity, membersRefreshFailures, refreshMembers]);

	return refreshMembers;
}

/**
 * Joins, move-outs and admin hand-overs by other members show up without a
 * reload; a 401 here is also how a removed member finds out.
 */
export function useMembersPolling(refreshMembers: () => Promise<void>, active: boolean): void {
	useVisibilityPausedInterval(() => void refreshMembers(), active ? 30_000 : null);
}
