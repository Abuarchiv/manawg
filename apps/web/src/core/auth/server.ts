import 'server-only';

import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { getSupabaseEnv, hasSupabaseEnv } from './env';

export function createSupabaseServerClient(request: NextRequest, response: NextResponse) {
	const { url, publishableKey } = getSupabaseEnv();

	return createServerClient(url, publishableKey, {
		cookies: {
			getAll: () => request.cookies.getAll(),
			setAll: (cookiesToSet, headers) => {
				for (const { name, value, options } of cookiesToSet) {
					response.cookies.set(name, value, options);
				}
				for (const [name, value] of Object.entries(headers)) {
					response.headers.set(name, value);
				}
			},
		},
	});
}

export async function getAuthenticatedUser(request: NextRequest): Promise<Pick<User, 'id'> | null> {
	const supabase = createSupabaseServerClient(request, NextResponse.next());
	const { data, error } = await supabase.auth.getUser();

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
	return error || !data.user ? null : { id: data.user.id };
}
