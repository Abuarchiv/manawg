import 'server-only';

import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { isTransientAuthError } from './auth-errors';
import { authCookieOptions } from './cookie-options';
import { applySessionHint } from './session-hint-cookie';
import { getSupabaseEnv, hasSupabaseEnv } from './supabase-env';

const SUPABASE_AUTH_TOKEN_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?$/;

function hasSupabaseAuthAttempt(request: NextRequest): boolean {
	return (
		request.headers.has('authorization') ||
		request.cookies.getAll().some(({ name }) => SUPABASE_AUTH_TOKEN_COOKIE.test(name))
	);
}

/**
 * `clientIp` is forwarded as `X-Forwarded-For`: Supabase Auth rate-limits sign-in, sign-up and
 * code verification per IP, and from the server every visitor would otherwise share ours.
 */
export function createSupabaseServerClient(
	request: NextRequest,
	response: NextResponse,
	clientIp?: string,
) {
	const { url, publishableKey } = getSupabaseEnv();
	const https = request.nextUrl.protocol === 'https:';

	return createServerClient(url, publishableKey, {
		cookieOptions: authCookieOptions(https),
		...(clientIp ? { global: { headers: { 'x-forwarded-for': clientIp } } } : {}),
		cookies: {
			getAll: () => request.cookies.getAll(),
			setAll: (cookiesToSet, headers) => {
				for (const { name, value, options } of cookiesToSet) {
					response.cookies.set(name, value, options);
				}
				applySessionHint(response.cookies, cookiesToSet, https);
				for (const [name, value] of Object.entries(headers)) {
					response.headers.set(name, value);
				}
			},
		},
	});
}

export async function getAuthenticatedUser(request: NextRequest): Promise<Pick<User, 'id'> | null> {
	if (!hasSupabaseAuthAttempt(request)) return null;
	const supabase = createSupabaseServerClient(request, NextResponse.next());
	const { data, error } = await supabase.auth.getUser();

	if (isTransientAuthError(error)) throw error;
	return error || !data.user ? null : { id: data.user.id };
}

/** Read the middleware-refreshed session in a server component without a module-level client. */
export async function getAuthenticatedUserFromCookies(): Promise<Pick<User, 'id'> | null> {
	if (!hasSupabaseEnv()) return null;
	const cookieStore = await cookies();
	const { url, publishableKey } = getSupabaseEnv();
	const supabase = createServerClient(url, publishableKey, {
		cookies: {
			getAll: () => cookieStore.getAll(),
			setAll: () => undefined,
		},
	});
	const { data, error } = await supabase.auth.getUser();
	if (isTransientAuthError(error)) throw error;
	return error || !data.user ? null : { id: data.user.id };
}
