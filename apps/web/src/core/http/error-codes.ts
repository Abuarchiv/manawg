/**
 * Classification for the generic API-error taxonomy shared by every WG
 * mutation/load path: network failure, retryable server failure,
 * WG-unavailable, invalid share code, and auth-invalidated.
 *
 * These predicates classify a `(code, status?)` pair. `mutationErrorMessage`
 * turns the shared buckets into one German sentence; each feature only supplies
 * its subject and its feature-specific codes.
 */

const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVER_ERROR = 500;
const HTTP_TOO_MANY = 429;

export function isNetworkError(code: string | null, status?: number): boolean {
	return status === 0 || code === 'Netzwerkfehler' || code === 'Failed to fetch';
}

export const RATE_LIMITED_MESSAGE = 'Zu viele Anfragen. Warte kurz und versuche es dann erneut.';

export function isRateLimited(code: string | null, status?: number): boolean {
	return status === 429 || code === 'too_many_requests';
}

export function isRetryableServerError(code: string | null, status?: number): boolean {
	return (
		code === 'unexpected_error' ||
		code === 'server_error' ||
		code === 'db_error' ||
		code === 'too_many_requests' ||
		status === HTTP_TOO_MANY ||
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

/**
 * Error copy for a failed mutation: the shared buckets first (network, retryable,
 * WG unavailable, share code, auth), then the feature's own `specific` texts, else
 * `fallback`. `retrySubject` lets the retryable bucket name a different action.
 */
export function mutationErrorMessage(
	subject: string,
	code: string,
	specific: Readonly<Record<string, string>>,
	fallback: string,
	retrySubject: string = subject,
): string {
	if (isNetworkError(code)) return `${subject}: Prüfe deine Verbindung und versuche es erneut.`;
	if (isRetryableServerError(code)) return `${retrySubject}: Versuche es gleich erneut.`;
	if (isWgUnavailable(code)) return `${subject}: Öffne die WG über den aktuellen Link erneut.`;
	if (isInvalidShareCode(code)) return `${subject}: Der WG-Code ist ungültig.`;
	if (isAuthInvalidated(code)) return `${subject}: Tritt der WG erneut bei.`;
	return Object.hasOwn(specific, code) ? (specific[code] as string) : fallback;
}
