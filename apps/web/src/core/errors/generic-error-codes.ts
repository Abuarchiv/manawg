/**
 * Classification for the generic API-error taxonomy shared by every WG
 * mutation/load path: network failure, retryable server failure,
 * WG-unavailable, invalid share code, and auth-invalidated.
 *
 * These predicates classify a `(code, status?)` pair — they never produce
 * user-facing copy. Each feature keeps its own German message text; only the
 * "which bucket is this error in" decision lives here.
 */

const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVER_ERROR = 500;

export function isNetworkError(code: string | null, status?: number): boolean {
	return status === 0 || code === 'Netzwerkfehler' || code === 'Failed to fetch';
}

export function isRetryableServerError(code: string | null, status?: number): boolean {
	return (
		code === 'unexpected_error' ||
		code === 'server_error' ||
		code === 'db_error' ||
		(status !== undefined && status >= HTTP_SERVER_ERROR)
	);
}

export function isWgUnavailable(code: string | null, status?: number): boolean {
	return status === HTTP_NOT_FOUND || code === 'wg_not_found';
}

export function isInvalidShareCode(code: string | null): boolean {
	return code === 'invalid_share_code';
}

export function isAuthInvalidated(code: string | null, status?: number): boolean {
	return (
		status === HTTP_UNAUTHORIZED ||
		code === 'not_a_member' ||
		code === 'member_id_required' ||
		code === 'member_id_invalid'
	);
}
