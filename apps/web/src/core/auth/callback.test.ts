import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
const createServerClient = vi.fn(() => ({ auth: { exchangeCodeForSession } }));

vi.mock('@supabase/ssr', () => ({ createServerClient }));

describe('GET /auth/callback', () => {
	beforeEach(() => {
		exchangeCodeForSession.mockClear();
		createServerClient.mockClear();
	});

	it('exchanges the OAuth code and redirects to a safe relative path', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
		const { GET } = await import('@/app/auth/callback/route');

		const response = await GET(
			new NextRequest('https://manawg.com/auth/callback?code=oauth-code&next=%2Fw%2Fabc'),
		);

		expect(exchangeCodeForSession).toHaveBeenCalledWith('oauth-code');
		expect(response.headers.get('location')).toBe('https://manawg.com/w/abc');
	});

	it('exchanges the code but falls back to root for an external next URL', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
		const { GET } = await import('@/app/auth/callback/route');

		const response = await GET(
			new NextRequest(
				'https://manawg.com/auth/callback?code=oauth-code&next=https%3A%2F%2Fevil.example',
			),
		);

		expect(exchangeCodeForSession).toHaveBeenCalledWith('oauth-code');
		expect(response.headers.get('location')).toBe('https://manawg.com/');
	});

	it('redirects with an error when the callback has no code', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
		const { GET } = await import('@/app/auth/callback/route');

		const response = await GET(new NextRequest('https://manawg.com/auth/callback'));

		expect(response.headers.get('location')).toBe('https://manawg.com/?error=auth_callback');
	});
});
