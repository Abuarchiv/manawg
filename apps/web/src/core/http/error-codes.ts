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
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;

/** `error` that `apiFetch` reports with status 0 when the request never got an answer. */
export const NETWORK_ERROR_CODE = 'Netzwerkfehler';
/** `error` that `apiFetch` reports with status 0 when the answer was not readable JSON. */
export const INVALID_RESPONSE_CODE = 'Unerwartete Serverantwort';

export const RATE_LIMITED_MESSAGE = 'Zu viele Anfragen. Warte kurz und versuche es dann erneut.';
export const READ_ONLY_MESSAGE =
	'Die App ist gerade in Wartung und nur lesbar. Versuche es später erneut.';
export const SESSION_EXPIRED_MESSAGE = 'Deine Sitzung ist abgelaufen. Melde dich neu an.';

export function isNetworkError(code: string | null, status?: number): boolean {
	return status === 0 || code === NETWORK_ERROR_CODE || code === 'Failed to fetch';
}

/**
 * The server names its 429s `too_many_requests` (default of `tooMany()`),
 * `rate_limited` (middleware and some routes) or a feature-specific
 * `*_rate_limited`. Callers that only keep the code, not the status, must still
 * recognise all of them.
 */
export function isRateLimited(code: string | null, status?: number): boolean {
	return (
		status === HTTP_TOO_MANY ||
		code === 'too_many_requests' ||
		code === 'rate_limited' ||
		code?.endsWith('_rate_limited') === true
	);
}

export function isRetryableServerError(code: string | null, status?: number): boolean {
	return (
		code === 'unexpected_error' ||
		code === 'server_error' ||
		code === 'service_unavailable' ||
		code === 'db_error' ||
		code === 'rate_limiter_unavailable' ||
		isRateLimited(code, status) ||
		(status !== undefined && status >= HTTP_SERVER_ERROR)
	);
}

function isWgUnavailable(code: string | null, status?: number): boolean {
	return status === HTTP_NOT_FOUND || code === 'wg_not_found';
}

function isInvalidShareCode(code: string | null): boolean {
	return code === 'invalid_share_code';
}

function isAuthInvalidated(code: string | null, status?: number): boolean {
	return status === HTTP_UNAUTHORIZED || code === 'not_a_member';
}

/** Supabase session expired (guards answer 401 `auth_required`); unlike `authInvalidated`, the membership is intact. */
export function isSessionExpired(code: string | null): boolean {
	return code === 'auth_required';
}

/** Middleware with `MIGRATION_READ_ONLY=true`: 503 `migration_read_only` on every mutation (maintenance). */
export function isReadOnlyMode(code: string | null): boolean {
	return code === 'migration_read_only';
}

export type ApiErrorKind =
	| 'network'
	| 'readOnly'
	| 'sessionExpired'
	| 'wgUnavailable'
	| 'invalidShareCode'
	| 'authInvalidated'
	| 'retryable';

/** Single bucket for an error; callers map the bucket to their own copy. */
export function classifyApiError(code: string | null, status?: number): ApiErrorKind | null {
	if (isNetworkError(code, status)) return 'network';
	// Before retryable/authInvalidated: the 503 or 401 would otherwise be misclassified.
	if (isReadOnlyMode(code)) return 'readOnly';
	if (isSessionExpired(code)) return 'sessionExpired';
	if (isWgUnavailable(code, status)) return 'wgUnavailable';
	if (isInvalidShareCode(code)) return 'invalidShareCode';
	if (isAuthInvalidated(code, status)) return 'authInvalidated';
	if (isRetryableServerError(code, status)) return 'retryable';
	return null;
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
	// Before the retryable bucket: a 429 is retryable, but "warte kurz" is the useful next step.
	if (isRateLimited(code)) return `${subject}: ${RATE_LIMITED_MESSAGE}`;
	if (isReadOnlyMode(code)) return `${subject}: ${READ_ONLY_MESSAGE}`;
	if (isSessionExpired(code)) return `${subject}: ${SESSION_EXPIRED_MESSAGE}`;
	if (isRetryableServerError(code)) return `${retrySubject}: Versuche es gleich erneut.`;
	if (isWgUnavailable(code)) return `${subject}: Öffne die WG über den aktuellen Link erneut.`;
	if (isInvalidShareCode(code)) return `${subject}: Der WG-Code ist ungültig.`;
	if (isAuthInvalidated(code)) return `${subject}: Tritt der WG erneut bei.`;
	return Object.hasOwn(specific, code) ? (specific[code] as string) : fallback;
}
