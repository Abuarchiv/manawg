'use client';

import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import type { SessionMember } from '@/core/auth/local-account';
import { subscribeOnline } from '@/core/hooks/use-online-status';
import { apiFetch } from '@/core/infra/api-client';
import { captureException } from '@/core/infra/capture-client';
import {
	LIST_REFRESH_INTERVAL_MS,
	useVisibilityPausedInterval,
} from '@/core/utils/use-visibility-paused-interval';
import type { Member } from './WgContextProvider';
import type { WgAuthRef, WgSessionAction } from './wg-session-state';

/**
 * Members list and admin flag from /api/wg/[code]/members, refetched when the
 * identity changes and retried with backoff after transient failures.
 */
export function useMembersRefresh({
	encodedShareCode,
	identity,
	accountReady,
	serverVerified,
	auth,
	setMembers,
	dispatch,
}: {
	encodedShareCode: string;
	identity: SessionMember | null;
	accountReady: boolean;
	serverVerified: boolean;
	auth: RefObject<WgAuthRef>;
	setMembers: Dispatch<SetStateAction<Member[]>>;
	dispatch: Dispatch<WgSessionAction>;
}): () => Promise<void> {
	// Consecutive non-auth failures (429, 5xx, network) of the members/admin
	// fetch. Without retries isAdmin would stay false for
	// the whole session and hide every admin action.
	const [membersRefreshFailures, setMembersRefreshFailures] = useState(0);

	const refreshMembers = useCallback(async () => {
		if (!identity || !accountReady) return;
		const authGeneration = auth.current.generation;
		try {
			const res = await apiFetch<{
				members: Array<Member & { active?: boolean }>;
				viewerIsAdmin?: boolean;
			}>(`/api/wg/${encodedShareCode}/members`, {
				memberId: identity.memberId,
			});
			if (authGeneration !== auth.current.generation) return;
			// Normalize defensively: an omitted flag (e.g. E2E fixtures) means active.
			if (res.ok) {
				const next = res.data.members.map((m) => ({ ...m, active: m.active !== false }));
				// Polled every 30 s: keep an unchanged list, otherwise every useWg() consumer re-renders for nothing.
				setMembers((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
				dispatch({ type: 'admin', isAdmin: res.data.viewerIsAdmin === true });
				setMembersRefreshFailures(0);
				return;
			}
			// Keep counting transient failures so the retry backs off (5 s → 60 s).
			// An expired session (401 auth_required) is shown by the shared session banner.
			if (res.error === 'member_context_changed') {
				// Another tab switched accounts: the layout resolves the new member.
				window.location.reload();
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
	}, [accountReady, auth, dispatch, encodedShareCode, identity, setMembers]);

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
	useVisibilityPausedInterval(
		() => void refreshMembers(),
		active ? LIST_REFRESH_INTERVAL_MS : null,
	);
}
