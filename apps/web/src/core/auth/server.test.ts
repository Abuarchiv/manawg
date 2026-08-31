import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

type ClientOptions = {
	cookies: {
		getAll: () => unknown[];
		setAll: (
			cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>,
			headers: Record<string, string>,
		) => void;
	};
};

const createServerClient = vi.fn((_url: string, _key: string, _options: ClientOptions) => ({
	auth: {},
}));

vi.mock('@supabase/ssr', () => ({ createServerClient }));

describe('createSupabaseServerClient', () => {
	it('connects Supabase auth cookies to the request and response', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
		const { createSupabaseServerClient } = await import('./server');
		const request = new NextRequest('https://manawg.com/auth/callback');
		const response = NextResponse.redirect('https://manawg.com/');

		createSupabaseServerClient(request, response);

		const options = createServerClient.mock.calls[0]?.[2];
		if (!options) throw new Error('server client options were not passed');
		expect(options.cookies.getAll()).toEqual([]);
		options.cookies.setAll(
			[{ name: 'sb-session', value: 'token', options: { httpOnly: true } }],
			{},
		);
		expect(response.cookies.get('sb-session')?.value).toBe('token');
	});

	it('returns only a server-verified user from a request', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
		const getUser = vi.fn(async () => ({ data: { user: { id: 'user-123' } }, error: null }));
		createServerClient.mockReturnValue({ auth: { getUser } });
		const { getAuthenticatedUser } = await import('./server');

		const user = await getAuthenticatedUser(new NextRequest('https://manawg.com/'));

		expect(getUser).toHaveBeenCalledOnce();
		expect(user).toEqual({ id: 'user-123' });
	});

	it('returns null when Supabase cannot verify the request', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
		const getUser = vi.fn(async () => ({
			data: { user: null },
			error: new Error('invalid session'),
		}));
		createServerClient.mockReturnValue({ auth: { getUser } });
		const { getAuthenticatedUser } = await import('./server');

		expect(await getAuthenticatedUser(new NextRequest('https://manawg.com/'))).toBeNull();
	});
});
