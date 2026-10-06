import { isAuthRetryableFetchError } from '@supabase/supabase-js';

/**
 * Whether a Supabase Auth failure is an outage (network error or 429) rather
 * than an invalid session. Callers answer an outage with a retryable 503 and
 * keep the session cookies, instead of signing the user out.
 */
export function isTransientAuthError(error: unknown): boolean {
	return (
		isAuthRetryableFetchError(error) ||
		(typeof error === 'object' && error !== null && 'status' in error && error.status === 429)
	);
}
