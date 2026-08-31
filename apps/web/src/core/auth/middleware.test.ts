import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createServerClient = vi.fn();

vi.mock('@supabase/ssr', () => ({ createServerClient }));

describe('refreshSupabaseSession', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
	});

	it('passes a refreshed cookie to the next handler and preserves response headers', async () => {
		let cookieOptions:
			| {
					cookies: {
						setAll: (cookies: Array<{ name: string; value: string; options: object }>) => void;
					};
			  }
			| undefined;
		const getUser = vi.fn(async () => {
			cookieOptions?.cookies.setAll([
				{ name: 'sb-session', value: 'fresh', options: { httpOnly: true } },
			]);
			return { data: { user: { id: 'user-1' } }, error: null };
		});
		createServerClient.mockImplementation((_url, _key, options) => {
			cookieOptions = options;
			return { auth: { getUser } };
		});
		const { refreshSupabaseSession } = await import('./middleware');
		const request = new NextRequest('https://manawg.test/wg/MTE8PZAT');
		const response = NextResponse.next();
		response.headers.set('Content-Security-Policy', "default-src 'self'");

		const refreshed = await refreshSupabaseSession(request, response);

		expect(getUser).toHaveBeenCalledOnce();
		expect(refreshed).not.toBe(response);
		expect(refreshed.cookies.get('sb-session')?.value).toBe('fresh');
		expect(refreshed.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
		expect(refreshed.headers.get('x-middleware-request-cookie')).toContain('sb-session=fresh');
	});
});
