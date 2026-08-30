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

	it('refreshes the verified session and returns replacement cookies to the browser', async () => {
		const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
		createServerClient.mockReturnValue({ auth: { getUser } });
		const { refreshSupabaseSession } = await import('./middleware');
		const request = new NextRequest('https://manawg.test/wg/MTE8PZAT');
		const response = NextResponse.next();

		const refreshed = await refreshSupabaseSession(request, response);
		const options = createServerClient.mock.calls[0]?.[2];
		if (!options) throw new Error('missing Supabase cookie options');
		options.cookies.setAll([{ name: 'sb-session', value: 'fresh', options: { httpOnly: true } }]);

		expect(getUser).toHaveBeenCalledOnce();
		expect(refreshed.cookies.get('sb-session')?.value).toBe('fresh');
	});
});
