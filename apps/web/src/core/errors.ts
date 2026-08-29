import { captureException } from '@/core/infra/observability';
import { NextResponse } from 'next/server';

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;

export const HTTP = {
	BAD_REQUEST: HTTP_BAD_REQUEST,
	FORBIDDEN: HTTP_FORBIDDEN,
	NOT_FOUND: HTTP_NOT_FOUND,
	CONFLICT: HTTP_CONFLICT,
	PAYLOAD_TOO_LARGE: HTTP_PAYLOAD_TOO_LARGE,
	TOO_MANY: HTTP_TOO_MANY,
	SERVER_ERROR: HTTP_SERVER_ERROR,
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

export function badRequest(message = 'bad_request', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP_BAD_REQUEST, code);
}

export function forbidden(message = 'forbidden', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP_FORBIDDEN, code);
}

/**
 * Money/state mutations that trust a caller-claimed id (owner checks, self-
 * settle, comment authorship) require a verified HMAC token first — a bare
 * `x-manawg-member-id` is spoofable. Returns the `forbidden` response to
 * return immediately, or `null` when the caller is verified.
 */
export function requireVerifiedMember(member: {
	verified: boolean;
}): NextResponse<ApiErrorBody> | null {
	if (!member.verified) return forbidden('member_not_verified', 'member_not_verified');
	return null;
}

export function conflict(message = 'conflict', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP_CONFLICT, code);
}

export function notFound(message = 'not_found', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP_NOT_FOUND, code);
}

export function tooMany(message = 'too_many_requests', code?: string): NextResponse<ApiErrorBody> {
	return apiError(message, HTTP_TOO_MANY, code);
}

/**
 * Return a 500 server_error response.
 *
 * Supports two calling styles (backward-compatible):
 *   - `serverError()` — response-only path, nothing reported
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
	if (typeof errOrMessage === 'string' || errOrMessage === undefined) {
		const finalMessage = typeof errOrMessage === 'string' ? errOrMessage : message;
		if (typeof errOrMessage === 'string') {
			captureException(new Error(finalMessage));
		}
		return apiError(finalMessage, HTTP_SERVER_ERROR, code);
	}

	captureException(errOrMessage);
	return apiError(message, HTTP_SERVER_ERROR, code);
}
