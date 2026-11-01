import { type NextRequest, NextResponse } from 'next/server';
import { passwordRecoveryCookie } from '@/core/auth/password-pending';

export async function DELETE(request: NextRequest): Promise<NextResponse> {
	const response = NextResponse.json({ cleared: true });
	response.cookies.set({
		...passwordRecoveryCookie('', request.nextUrl.protocol === 'https:'),
		maxAge: 0,
	});
	return response;
}
