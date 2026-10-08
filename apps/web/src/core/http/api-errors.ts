import { captureException } from '@/core/infra/observability';
import type { RateLimitResult } from '@/core/rate-limit';
import { NextResponse } from 'next/server';

export const HTTP = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	PAYLOAD_TOO_LARGE: 413,
	TOO_MANY: 429,
	SERVER_ERROR: 500,
	SERVICE_UNAVAILABLE: 503,
} as const;

interface ApiErrorBody {
	error: string;
	code?: string;
}

export function apiError(
	message: string,
	status: number,
	code?: string,
): NextResponse<ApiErrorBody> {
	const body: ApiErrorBody = code !== undefined ? { error: message, code } : { error: message };
	return NextResponse.json<ApiErrorBody>(body, { status });
}

const IDEMPOTENCY_RETRYABLE_CODES = new Set([
	'idempotency_claim_failed',
	'idempotency_cache_read_failed',
	'idempotency_response_pending',
]);

function isIdempotencyRetryable(value: unknown): boolean {
	const message = typeof value === 'string' ? value : value instanceof Error ? value.message : null;
	return message !== null && IDEMPOTENCY_RETRYABLE_CODES.has(message);
}

function idempotencyRetryableResponse(): NextResponse<ApiErrorBody> {
	return NextResponse.json<ApiErrorBody>(
		{ error: 'service_unavailable', code: 'idempotency_retryable' },
		{ status: HTTP.SERVICE_UNAVAILABLE, headers: { 'Retry-After': '1' } },
	);
}

/**
 * The write committed but its response cannot be replayed (it was too large to keep). Retrying
 * can never succeed, so this is a final 409 rather than a retryable 503.
 */
const IDEMPOTENCY_UNAVAILABLE = 'idempotency_response_unavailable';

function isIdempotencyUnavailable(value: unknown): boolean {
	return (
		value === IDEMPOTENCY_UNAVAILABLE ||
		(value instanceof Error && value.message === IDEMPOTENCY_UNAVAILABLE)
	);
}

export function badRequest(message = 'bad_request', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP.BAD_REQUEST, code);
}

export function unauthorized(message = 'unauthorized', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP.UNAUTHORIZED, code);
}

export function forbidden(message = 'forbidden', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP.FORBIDDEN, code);
}

export function conflict(message = 'conflict', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP.CONFLICT, code);
}

export function notFound(message = 'not_found', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP.NOT_FOUND, code);
}

export function tooMany(message = 'too_many_requests', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP.TOO_MANY, code);
}

export function serviceUnavailable(
	message = 'service_unavailable',
	code?: string,
): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP.SERVICE_UNAVAILABLE, code);
}

export function payloadTooLarge(
	message = 'payload_too_large',
	code = 'payload_too_large',
): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP.PAYLOAD_TOO_LARGE, code);
}

/**
 * `null` when the limiter admitted the request. Otherwise 429 with the given message, or a
 * retryable 503 `rate_limiter_unavailable` when a fail-closed limiter could not decide: that is
 * an outage, not the caller's fault.
 */
export function rateLimitResponse(
	result: RateLimitResult,
	message = 'too_many_requests',
	code?: string,
): NextResponse | null {
	if (result.success) return null;
	if (!result.limiterUnavailable) return tooMany(message, code);
	const retryAfterMs = Math.max(0, result.reset - Date.now());
	return NextResponse.json(
		{ error: 'rate_limiter_unavailable', retryAfterMs },
		{
			status: HTTP.SERVICE_UNAVAILABLE,
			headers: { 'Retry-After': Math.max(1, Math.ceil(retryAfterMs / 1000)).toString() },
		},
	);
}

/**
 * Response for a body `readJsonLimited` refused: 413 when it exceeded the byte
 * cap (the client should shorten it, not retry), otherwise 400 `invalid_json`.
 */
export function unreadableJsonBody(err: unknown): NextResponse<ApiErrorBody> {
	return err instanceof Error && err.message === 'payload_too_large'
		? payloadTooLarge()
		: badRequest('invalid_json');
}

/**
 * Return a server error response. Idempotency safety failures are returned as
 * an explicit retryable 503 so callers never continue into the mutation.
 *
 * Supports two calling styles (backward-compatible):
 *   - `serverError()` — reports `server_error`, so bare calls are still
 *     visible to error monitoring instead of failing silently
 *   - `serverError('share_code_exhausted')` — response message, also reported
 *   - `serverError(err, 'message')` — reports the caught error, then returns 500
 *
 * Heuristic: if the first arg is a `string` (or omitted), it is treated as the
 * response message. Anything else is treated as the error to report.
 *
 * Using this helper from API route catch blocks keeps error reporting out of
 * every individual route file.
 */
export function serverError(
	errOrMessage?: unknown,
	message = 'server_error',
	code?: string,
): NextResponse<ApiErrorBody> {
	if (isIdempotencyRetryable(errOrMessage)) {
		captureException(typeof errOrMessage === 'string' ? new Error(errOrMessage) : errOrMessage);
		return idempotencyRetryableResponse();
	}
	if (isIdempotencyUnavailable(errOrMessage)) {
		captureException(typeof errOrMessage === 'string' ? new Error(errOrMessage) : errOrMessage);
		return apiError(IDEMPOTENCY_UNAVAILABLE, HTTP.CONFLICT, IDEMPOTENCY_UNAVAILABLE);
	}
	if (errOrMessage === null) {
		captureException(new Error(message));
		return apiError(message, HTTP.SERVER_ERROR, code);
	}
	if (typeof errOrMessage === 'string' || errOrMessage === undefined) {
		const finalMessage = typeof errOrMessage === 'string' ? errOrMessage : message;
		captureException(new Error(finalMessage));
		return apiError(finalMessage, HTTP.SERVER_ERROR, code);
	}

	captureException(errOrMessage);
	return apiError(message, HTTP.SERVER_ERROR, code);
}
