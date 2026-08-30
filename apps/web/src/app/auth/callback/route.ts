import { safeNextPath } from '@/core/auth/next-path';
import { createSupabaseServerClient } from '@/core/auth/server';
import { type NextRequest, NextResponse } from 'next/server';

function callbackError(request: NextRequest): NextResponse {
	return NextResponse.redirect(new URL('/?error=auth_callback', request.url));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
	const code = request.nextUrl.searchParams.get('code');
	if (!code) return callbackError(request);

	const response = NextResponse.redirect(
		new URL(safeNextPath(request.nextUrl.searchParams.get('next')), request.url),
	);
	const supabase = createSupabaseServerClient(request, response);
	const { error } = await supabase.auth.exchangeCodeForSession(code);

	return error ? callbackError(request) : response;
}
