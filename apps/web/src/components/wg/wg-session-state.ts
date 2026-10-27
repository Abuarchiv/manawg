import type { SessionMember } from '@/core/auth/local-account';

/** The member the account has in this WG, plus the load/session flags that gate the WG shell. */
export interface WgSessionState {
	identity: SessionMember | null;
	/** UI gating only; every mutation re-checks server-side. */
	isAdmin: boolean;
	/** The account session is confirmed; background work that needs it waits for it. */
	accountReady: boolean;
	/** The first member lookup (or a hard reload of it) has finished, successfully or not. */
	memberLoaded: boolean;
	/** The last lookup failed for a transient reason (network, 429, 5xx) and can be retried. */
	memberLoadError: boolean;
	/** The Supabase session is gone (sign-out, expired refresh token): not the same as "not a member". */
	sessionEnded: boolean;
}

export type WgSessionAction =
	/** A member lookup starts; without `keepCurrentContext` the shell falls back to its skeleton. */
	| { type: 'loading'; keepCurrentContext?: boolean }
	/** The server named the member. Keeps the same object when memberId, name and authUserId match. */
	| { type: 'member-loaded'; identity: SessionMember }
	/** Status 0, 429 or 5xx for the account the layout verified: keep the server-verified member. */
	| { type: 'kept-after-transient-failure'; identity: SessionMember }
	/** 401 `auth_required`: the session cookies are gone. */
	| { type: 'session-ended' }
	/** Another request found out that this member left, was removed or the code rotated. */
	| { type: 'member-lost' }
	/** The lookup answered without a member; `retryable` for transient failures. */
	| { type: 'load-failed'; retryable: boolean }
	| { type: 'admin'; isAdmin: boolean };

/** Mutable auth bookkeeping shared by the session hooks and the offline replay (never rendered). */
export interface WgAuthRef {
	/** The account the current lookup belongs to. */
	userId: string | null;
	/** Bumped when the account context ends so late answers of older lookups are dropped. */
	generation: number;
	/** Cancels a running offline replay when the account context ends. */
	syncAbort: AbortController | null;
}

/** A server-verified identity (it carries `authUserId`) starts ready instead of waiting for the lookup. */
export function initWgSessionState(
	initialIdentity: SessionMember | undefined,
	initialIsAdmin: boolean | undefined,
): WgSessionState {
	const serverVerified = Boolean(initialIdentity?.authUserId);
	return {
		identity: initialIdentity ?? null,
		isAdmin: serverVerified && initialIsAdmin === true,
		accountReady: serverVerified,
		memberLoaded: serverVerified,
		memberLoadError: false,
		sessionEnded: false,
	};
}

function sameMember(a: SessionMember | null, b: SessionMember): boolean {
	return (
		a !== null && a.memberId === b.memberId && a.name === b.name && a.authUserId === b.authUserId
	);
}

/** Returns `state` itself when nothing changes, so React skips the re-render. */
function patch(state: WgSessionState, changes: Partial<WgSessionState>): WgSessionState {
	const keys = Object.keys(changes) as Array<keyof WgSessionState>;
	return keys.every((key) => state[key] === changes[key]) ? state : { ...state, ...changes };
}

const WITHOUT_MEMBER = {
	identity: null,
	isAdmin: false,
	accountReady: false,
	memberLoaded: true,
} as const;

export function wgSessionReducer(state: WgSessionState, action: WgSessionAction): WgSessionState {
	switch (action.type) {
		case 'loading':
			return patch(state, {
				memberLoadError: false,
				...(action.keepCurrentContext ? {} : { memberLoaded: false }),
			});
		case 'member-loaded':
			// A new identity object re-runs refreshMembers and every page fetch keyed on it.
			return patch(state, {
				sessionEnded: false,
				identity: sameMember(state.identity, action.identity) ? state.identity : action.identity,
				accountReady: true,
				memberLoaded: true,
			});
		case 'kept-after-transient-failure':
			return patch(state, {
				identity: state.identity ?? action.identity,
				accountReady: true,
				memberLoaded: true,
			});
		case 'session-ended':
			return patch(state, { ...WITHOUT_MEMBER, sessionEnded: true, memberLoadError: false });
		case 'member-lost':
			return patch(state, WITHOUT_MEMBER);
		case 'load-failed':
			return patch(state, { ...WITHOUT_MEMBER, memberLoadError: action.retryable });
		case 'admin':
			return patch(state, { isAdmin: action.isAdmin });
	}
}
