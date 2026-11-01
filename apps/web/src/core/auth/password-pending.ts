import type { SupabaseClient } from '@supabase/supabase-js';
import { safeNextPath } from './next-path';

/** Where an account whose password was dropped at confirmation chooses a new one. */
const CHOOSE_PASSWORD_PATH = '/auth/reset?choose=1';

/** The page that chooses a password, carrying the validated page to continue to afterwards. */
export function choosePasswordHref(next: string | null): string {
	const target = safeNextPath(next);
	return target === '/'
		? CHOOSE_PASSWORD_PATH
		: `${CHOOSE_PASSWORD_PATH}&next=${encodeURIComponent(target)}`;
}

/** The address counts as just confirmed for this long, which covers the confirming exchange. */
const JUST_CONFIRMED_MS = 5 * 60_000;

/**
 * True when the address was confirmed just now and the password stored before was dropped, so
 * the account has none yet. Asks the server: the session's own copy of the user is from before
 * the database dropped the password.
 */
export async function passwordPending(auth: SupabaseClient['auth']): Promise<boolean> {
	const { data } = await auth.getUser();
	const user = data.user;
	if (user?.app_metadata?.password_pending !== true) return false;
	const confirmedAt = Date.parse(user.email_confirmed_at ?? '');
	return Date.now() - confirmedAt < JUST_CONFIRMED_MS;
}

export const PASSWORD_RECOVERY_COOKIE = 'manawg_password_recovery';

/** The marker lets /auth/reset accept a password change from the session user. */
export function passwordRecoveryCookie(userId: string, secure: boolean) {
	return {
		name: PASSWORD_RECOVERY_COOKIE,
		value: userId,
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: 600,
		path: '/auth/reset',
	} as const;
}
