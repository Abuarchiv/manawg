import { type NextRequest, NextResponse } from 'next/server';
import { safeNextPath } from '@/core/auth/next-path';
import {
	CHOOSE_PASSWORD_PATH,
	passwordPending,
	passwordRecoveryCookie,
} from '@/core/auth/password-pending';
import { createSupabaseServerClient } from '@/core/auth/server';
import { queueWelcomeMail } from '@/core/auth/welcome-mail';
import { requestOrigin } from '@/core/http/request-origin';
import { requestLocale } from '@/core/i18n/request-locale';

function callbackError(request: NextRequest, response?: NextResponse): NextResponse {
	const url = new URL('/login', requestOrigin(request));
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
	if (!code) {
		// An e-mail change confirms two links; the first one returns only a `message` and no code.
		// It worked, so go back to where the change was started instead of the error page.
		const params = request.nextUrl.searchParams;
		const partialConfirmation =
			params.has('message') && !params.has('error') && !params.has('error_description');
		if (!partialConfirmation || !next.startsWith('/') || next.startsWith('//')) {
			return callbackError(request);
		}
		const redirect = NextResponse.redirect(new URL(next, requestOrigin(request)));
		redirect.headers.set('Cache-Control', 'private, no-store');
		return redirect;
	}

	// Defense in depth: safeNextPath should already reject absolute URLs,
	// but verify at the redirect boundary so a future regression cannot
	// produce an open redirect.
	if (!next.startsWith('/') || next.startsWith('//')) {
		return callbackError(request);
	}

	const response = NextResponse.redirect(new URL(next, requestOrigin(request)));
	try {
		const supabase = createSupabaseServerClient(request, response);
		const { data, error } = await supabase.auth.exchangeCodeForSession(
			code,
			flowId !== null ? { flowId } : undefined,
		);
		if (error || !data.session) return callbackError(request, response);
		queueWelcomeMail(data.session.user, requestLocale(request));
		const choosePassword = await passwordPending(supabase.auth);
		if (choosePassword) {
			response.headers.set(
				'Location',
				new URL(CHOOSE_PASSWORD_PATH, requestOrigin(request)).toString(),
			);
		}
		if (choosePassword || next === '/auth/reset') {
			response.cookies.set(
				passwordRecoveryCookie(data.session.user.id, request.nextUrl.protocol === 'https:'),
			);
		}
		return response;
	} catch {
		return callbackError(request, response);
	}
}
