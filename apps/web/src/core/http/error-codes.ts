import type { Message } from '@/shared/i18n/message';

/**
 * Classification for the generic API-error taxonomy shared by every WG
 * mutation/load path: network failure, retryable server failure,
 * WG-unavailable, invalid share code, and auth-invalidated.
 *
 * These predicates classify a `(code, status?)` pair. `mutationError` turns the
 * shared buckets into one `Message`; each feature only supplies its subject and its feature-specific codes.
 */

const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;

/** `error` that `apiFetch` reports with status 0 when the request never got an answer. */
// i18n-ignore internal error code, never displayed
export const NETWORK_ERROR_CODE = 'Netzwerkfehler';
/** `error` that `apiFetch` reports with status 0 when the answer was not readable JSON. */
// i18n-ignore internal error code, never displayed
export const INVALID_RESPONSE_CODE = 'Unerwartete Serverantwort';

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

function withSubject(subject: Message, detailKey: Message['key']): Message {
	return { key: 'common.errors.withSubject', values: { subject, detail: { key: detailKey } } };
}

/**
 * Maps an error code to a message: the shared buckets (network, rate limit,
 * read-only, session, retry, unavailable) come first, then the feature's
 * `specific` texts, then `fallback`.
 */
export function mutationError(
	subject: Message,
	code: string,
	specific: Readonly<Record<string, Message>>,
	fallback: Message,
	retrySubject: Message = subject,
): Message {
	if (isNetworkError(code)) return withSubject(subject, 'common.errors.network');
	if (isRateLimited(code)) return withSubject(subject, 'common.errors.rateLimited');
	if (isReadOnlyMode(code)) return withSubject(subject, 'common.errors.readOnly');
	if (isSessionExpired(code)) return withSubject(subject, 'common.errors.sessionExpired');
	if (isRetryableServerError(code)) return withSubject(retrySubject, 'common.errors.retry');
	if (isWgUnavailable(code)) return withSubject(subject, 'common.errors.wgUnavailable');
	if (isInvalidShareCode(code)) return withSubject(subject, 'common.errors.invalidShareCode');
	if (isAuthInvalidated(code)) return withSubject(subject, 'common.errors.authInvalidated');
	return Object.hasOwn(specific, code) ? (specific[code] as Message) : fallback;
}
