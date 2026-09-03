import { safeNextPath } from '@/core/auth/next-path';
import { createSupabaseServerClient } from '@/core/auth/server';
import { type NextRequest, NextResponse } from 'next/server';

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
	if (!code) return callbackError(request);

	const response = NextResponse.redirect(
		new URL(safeNextPath(request.nextUrl.searchParams.get('next')), request.url),
	);
	try {
		const supabase = createSupabaseServerClient(request, response);
		const { error } = await supabase.auth.exchangeCodeForSession(
			code,
			flowId !== null ? { flowId } : undefined,
		);
		return error ? callbackError(request, response) : response;
	} catch {
		return callbackError(request, response);
	}
}
