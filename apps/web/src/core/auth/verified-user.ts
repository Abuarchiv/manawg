import type { SupabaseClient } from '@supabase/supabase-js';
import { isTransientAuthError } from './auth-errors';

/**
 * The signed-in user id, verified locally: `getClaims` checks the session JWT against the
 * project's JWKS (cached per instance for 10 minutes) instead of a `/auth/v1/user` round trip
 * on every request; an expired token still costs one refresh call. Projects signing with a
 * symmetric secret fall back to that round trip inside `getClaims`.
 *
 * Throws only for an Auth outage (network error, 5xx, 429), which callers answer with a
 * retryable 503. A cookie that is not a JWT at all makes `getClaims` throw a plain Error; that
 * is an invalid session, not an outage.
 */
export async function readVerifiedUser(
	auth: Pick<SupabaseClient['auth'], 'getClaims'>,
): Promise<{ id: string } | null> {
	let claims: { sub?: unknown } | undefined;
	try {
		const { data, error } = await auth.getClaims();
		if (error) {
			if (isTransientAuthError(error)) throw error;
			return null;
		}
		claims = data?.claims;
	} catch (error) {
		if (isTransientAuthError(error)) throw error;
		return null;
	}
	const sub = claims?.sub;
	return typeof sub === 'string' && sub.length > 0 ? { id: sub } : null;
}
