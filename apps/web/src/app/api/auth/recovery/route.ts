import { NextResponse } from 'next/server';

export async function DELETE(): Promise<NextResponse> {
	const response = NextResponse.json({ cleared: true });
	response.cookies.set({
		name: 'manawg_password_recovery',
		value: '',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 0,
		path: '/auth/reset',
	});
	return response;
}
