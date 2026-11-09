import type { User } from '@supabase/supabase-js';

/**
 * The /auth/callback route runs on the server, so it cannot send analytics events itself. It leaves
 * a one-shot marker for the page it redirects to: a short-lived cookie that holds nothing but the
 * name of the funnel step. The page reads it once, sends the event and deletes the cookie.
 */
const FUNNEL_MARKER_COOKIE = 'manawg_funnel';

export type FunnelMarker = 'signup_confirmed' | 'login_completed';

/** Long enough for the redirect and the first page load, short enough that a stale marker never fires later. */
const MARKER_MAX_AGE_SECONDS = 120;

/** A session whose account was confirmed (or created by Google) this recently belongs to a new account. */
const NEW_ACCOUNT_WINDOW_MS = 2 * 60 * 1000;

export function funnelMarkerCookie(marker: FunnelMarker, secure: boolean) {
	return {
		name: FUNNEL_MARKER_COOKIE,
		value: marker,
		httpOnly: false,
		secure,
		sameSite: 'lax',
		maxAge: MARKER_MAX_AGE_SECONDS,
		path: '/',
	} as const;
}

/**
 * The funnel step a session from /auth/callback stands for, or null when it is none:
 * - the first session of an account (mail confirmation or first Google sign-in): `signup_confirmed`;
 * - a later sign-in: `login_completed`, except a password recovery and a browser that was already
 *   signed in (linking Google, confirming a new e-mail address), which are no sign-in.
 */
export function funnelMarkerForSession(input: {
	user: Pick<User, 'created_at'> & { email_confirmed_at?: string | undefined };
	next: string;
	hadSession: boolean;
	now?: number;
}): FunnelMarker | null {
	const { user, next, hadSession, now = Date.now() } = input;
	const startedAt = Date.parse(user.email_confirmed_at ?? user.created_at);
	if (Number.isFinite(startedAt) && now - startedAt <= NEW_ACCOUNT_WINDOW_MS) {
		return 'signup_confirmed';
	}
	if (hadSession || next === '/auth/reset') return null;
	return 'login_completed';
}

/** Reads the marker out of a `document.cookie` string; unknown values are ignored. */
export function readFunnelMarker(cookieHeader: string): FunnelMarker | null {
	const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${FUNNEL_MARKER_COOKIE}=([a-z_]+)`));
	return match?.[1] === 'signup_confirmed' || match?.[1] === 'login_completed' ? match[1] : null;
}

/** The `document.cookie` value that deletes the marker. */
export function clearFunnelMarker(): string {
	return `${FUNNEL_MARKER_COOKIE}=; Max-Age=0; Path=/`;
}
