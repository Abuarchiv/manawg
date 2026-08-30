import { createServerClient } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import { getSupabaseEnv, hasSupabaseEnv } from './env';

/** Refreshes an existing social-login session without making auth configuration mandatory for guests. */
export async function refreshSupabaseSession(
	request: NextRequest,
	response: NextResponse,
): Promise<NextResponse> {
	if (!hasSupabaseEnv()) return response;

	const { url, publishableKey } = getSupabaseEnv();
	const supabase = createServerClient(url, publishableKey, {
		cookies: {
			getAll: () => request.cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					request.cookies.set(name, value);
					response.cookies.set(name, value, options);
				}
			},
		},
	});

	try {
		await supabase.auth.getUser();
	} catch {
		// Route handlers still reject unverified writes; a transient auth refresh must not break public pages.
	}
	return response;
}
