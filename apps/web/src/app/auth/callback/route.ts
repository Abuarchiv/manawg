import { safeNextPath } from '@/core/auth/next-path';
import { createSupabaseServerClient } from '@/core/auth/server';
import { afterResponse } from '@/core/infra/after-response';
import { sendMailSafely } from '@/core/mail/send-mail';
import { renderWelcomeMail } from '@/core/mail/templates';
import type { User } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

// A session for an account younger than this is the first one: the welcome mail (E1) goes out once.
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

function firstName(user: User): string | null {
	const meta = user.user_metadata as Record<string, unknown> | undefined;
	const raw = [meta?.full_name, meta?.name, meta?.given_name].find(
		(value): value is string => typeof value === 'string' && value.trim().length > 0,
	);
	return raw ? (raw.trim().split(/\s+/)[0] ?? null) : null;
}

function queueWelcomeMail(user: User): void {
	const createdAt = Date.parse(user.created_at);
	if (!user.email || !user.email_confirmed_at || !Number.isFinite(createdAt)) return;
	if (Date.now() - createdAt > NEW_ACCOUNT_WINDOW_MS) return;
	const to = user.email;
	afterResponse(() =>
		sendMailSafely({
			kind: 'welcome',
			dedupeKey: `welcome:${user.id}`,
			to,
			mail: renderWelcomeMail({ firstName: firstName(user) }),
		}),
	);
}

function callbackError(request: NextRequest, response?: NextResponse): NextResponse {
	const url = new URL('/neu', request.url);
	url.searchParams.set('error', 'auth_callback');
	url.searchParams.set('next', safeNextPath(request.nextUrl.searchParams.get('next')));
	const redirect = response ?? NextResponse.redirect(url);
	redirect.headers.set('Location', url.toString());
	redirect.headers.set('Cache-Control', 'private, no-store');
	return redirect;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
	const code = request.nextUrl.searchParams.get('code');
	const flowId = request.nextUrl.searchParams.get('sb_flow_id');
	const next = safeNextPath(request.nextUrl.searchParams.get('next'));
	if (!code) return callbackError(request);

	// Defense in depth: safeNextPath should already reject absolute URLs,
	// but verify at the redirect boundary so a future regression cannot
	// produce an open redirect.
	if (!next.startsWith('/') || next.startsWith('//')) {
		return callbackError(request);
	}

	const response = NextResponse.redirect(new URL(next, request.url));
	try {
		const supabase = createSupabaseServerClient(request, response);
		const { data, error } = await supabase.auth.exchangeCodeForSession(
			code,
			flowId !== null ? { flowId } : undefined,
		);
		if (error || !data.session) return callbackError(request, response);
		queueWelcomeMail(data.session.user);
		if (next === '/auth/reset') {
			response.cookies.set({
				name: 'manawg_password_recovery',
				value: data.session.user.id,
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
				maxAge: 600,
				path: '/auth/reset',
			});
		}
		return response;
	} catch {
		return callbackError(request, response);
	}
}
