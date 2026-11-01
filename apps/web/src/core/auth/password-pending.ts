import type { SupabaseClient } from '@supabase/supabase-js';

/** Where an account whose password was dropped at confirmation chooses a new one. */
export const CHOOSE_PASSWORD_PATH = '/auth/reset?choose=1';

/**
 * True when the address was just confirmed and the password stored before that was dropped, so
 * the account has none yet. Asks the server: the session's own copy of the user is from before
 * the database dropped the password.
 */
export async function passwordPending(auth: SupabaseClient['auth']): Promise<boolean> {
	const { data } = await auth.getUser();
	return data.user?.app_metadata?.password_pending === true;
}

/** The marker that lets /auth/reset accept a password change from a session of this user. */
export function passwordRecoveryCookie(userId: string, secure: boolean) {
	return {
		name: 'manawg_password_recovery',
		value: userId,
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: 600,
		path: '/auth/reset',
	} as const;
}
