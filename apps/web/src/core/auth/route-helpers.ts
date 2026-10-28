import 'server-only';

import {
	AuthSessionMissingError,
	isAuthError,
	isAuthRetryableFetchError,
} from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';
import { createSupabaseServerClient } from '@/core/auth/server';
import { hasSupabaseEnv } from '@/core/auth/supabase-env';
import {
	apiError,
	rateLimitResponse,
	serverError,
	serviceUnavailable,
	unauthorized,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { requestOrigin } from '@/core/http/request-origin';
import {
	authAttemptLimiter,
	checkRateLimit,
	clientIpKey,
	rateLimitFailMode,
} from '@/core/rate-limit';
import { safeNextPath } from './next-path';

export type AuthRouteContext<T> = {
	supabase: ReturnType<typeof createSupabaseServerClient>;
	data: T;
	/** Cookies written here (and by the Supabase client) are sent with the response. */
	cookies: NextResponse['cookies'];
	request: NextRequest;
	/** The `/auth/callback` URL on this origin that a mail or provider redirect should return to. */
	callbackUrl: (next: string) => string;
};

/**
 * Turn a Supabase Auth error into the JSON error format of the API. The Supabase error code is
 * passed through as `error` and `code` so the client can keep mapping it to German texts.
 */
function authErrorResponse(error: unknown): NextResponse {
	if (isAuthRetryableFetchError(error))
		return serviceUnavailable('auth_unavailable', 'auth_unavailable');
	if (error instanceof AuthSessionMissingError)
		return unauthorized('auth_required', 'auth_required');
	if (isAuthError(error)) {
		const code = error.code ?? 'auth_error';
		const status =
			error.status !== undefined && error.status >= 400 && error.status < 600 ? error.status : 500;
		return apiError(code, status, code);
	}
	return serverError(error, 'auth_error');
}

type Options<S extends z.ZodTypeAny | undefined> = {
	schema?: S;
	/** Apply the per-IP attempt limit (credential checks and mails). */
	limited?: boolean;
};

async function run<T>(
	request: NextRequest,
	options: Options<z.ZodTypeAny | undefined>,
	handler: (context: AuthRouteContext<T>) => Promise<object>,
): Promise<NextResponse> {
	if (!hasSupabaseEnv()) return serviceUnavailable('auth_unavailable', 'auth_unavailable');
	const ip = clientIpKey(request);
	if (options.limited) {
		const limited = rateLimitResponse(
			await checkRateLimit(authAttemptLimiter, ip, rateLimitFailMode()),
			'rate_limited',
			'over_request_rate_limit',
		);
		if (limited) return limited;
	}
	let data: unknown;
	if (options.schema) {
		const parsed = await parseBody(request, options.schema);
		if (!parsed.ok) return parsed.response;
		data = parsed.data;
	}

	// The Supabase client writes its cookies here; they are copied onto the final response.
	const cookieHolder = NextResponse.next();
	const finish = (response: NextResponse): NextResponse => {
		for (const cookie of cookieHolder.cookies.getAll()) response.cookies.set(cookie);
		response.headers.set('Cache-Control', 'private, no-store');
		return response;
	};
	try {
		const body = await handler({
			supabase: createSupabaseServerClient(
				request,
				cookieHolder,
				ip === 'anonymous' ? undefined : ip,
			),
			data: data as T,
			cookies: cookieHolder.cookies,
			request,
			callbackUrl: (next) => {
				const url = new URL('/auth/callback', requestOrigin(request));
				url.searchParams.set('next', safeNextPath(next));
				return url.toString();
			},
		});
		return finish(NextResponse.json(body));
	} catch (error) {
		return finish(authErrorResponse(error));
	}
}

/** POST route with a validated JSON body. Throw a Supabase `AuthError` to answer with its code. */
export function authPost<S extends z.ZodTypeAny>(
	schema: S,
	handler: (context: AuthRouteContext<z.output<S>>) => Promise<object>,
	options: { limited?: boolean } = {},
): (request: NextRequest) => Promise<NextResponse> {
	return (request) => run(request, { ...options, schema }, handler);
}

/** GET route; same error handling as {@link authPost}. */
export function authGet(
	handler: (context: AuthRouteContext<undefined>) => Promise<object>,
): (request: NextRequest) => Promise<NextResponse> {
	return (request) => run(request, {}, handler);
}
