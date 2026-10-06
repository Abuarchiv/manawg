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

export function isNetworkError(code: string | null, status?: number): boolean {
	return status === 0 || code === 'Netzwerkfehler' || code === 'Failed to fetch';
}

export const RATE_LIMITED_MESSAGE = 'Zu viele Anfragen. Warte kurz und versuche es dann erneut.';

/**
 * The server names its 429s `too_many_requests` (default of `tooMany()`),
 * `rate_limited` (middleware and some routes) or a feature-specific
 * `*_rate_limited`. Callers that only keep the code, not the status, must still
 * recognise all of them.
 */
export const READ_ONLY_MESSAGE =
	'Die App ist gerade in Wartung und nur lesbar. Versuche es später erneut.';
export const SESSION_EXPIRED_MESSAGE = 'Deine Sitzung ist abgelaufen. Melde dich neu an.';

export function isRateLimited(code: string | null, status?: number): boolean {
	return (
		status === 429 ||
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
	return (
		status === HTTP_UNAUTHORIZED ||
		code === 'not_a_member' ||
		code === 'member_id_required' ||
		code === 'member_id_invalid'
	);
}

/** Supabase-Sitzung abgelaufen (Guards antworten 401 `auth_required`); anders als `authInvalidated` ist die Mitgliedschaft intakt. */
export function isSessionExpired(code: string | null): boolean {
	return code === 'auth_required';
}

/** Middleware bei `MIGRATION_READ_ONLY=true`: 503 `migration_read_only` auf jede Mutation (Wartung). */
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
	// Vor retryable/authInvalidated: 503 bzw. 401 würden sonst falsch eingeordnet.
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
	if (isReadOnlyMode(code)) return `${subject}: ${READ_ONLY_MESSAGE}`;
	if (isSessionExpired(code)) return `${subject}: ${SESSION_EXPIRED_MESSAGE}`;
	if (isRetryableServerError(code)) return `${retrySubject}: Versuche es gleich erneut.`;
	if (isWgUnavailable(code)) return `${subject}: Öffne die WG über den aktuellen Link erneut.`;
	if (isInvalidShareCode(code)) return `${subject}: Der WG-Code ist ungültig.`;
	if (isAuthInvalidated(code)) return `${subject}: Tritt der WG erneut bei.`;
	return Object.hasOwn(specific, code) ? (specific[code] as string) : fallback;
}
