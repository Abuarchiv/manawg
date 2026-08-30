import { describe, expect, it, vi } from 'vitest';

const createBrowserClient = vi.fn(() => ({ auth: {} }));

vi.mock('@supabase/ssr', () => ({ createBrowserClient }));

describe('createSupabaseBrowserClient', () => {
	it('creates the official browser client from public Supabase config', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');

		const { createSupabaseBrowserClient } = await import('./client');
		createSupabaseBrowserClient();

		expect(createBrowserClient).toHaveBeenCalledWith(
			'https://project.supabase.co',
			'sb_publishable_test',
		);
	});

	it("starts OAuth with ManaWG's callback and preserves the relative return path", async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
		vi.stubGlobal('window', { location: { origin: 'https://manawg.test' } });
		const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
		createBrowserClient.mockReturnValue({ auth: { signInWithOAuth } });
		const { startSocialLogin } = await import('./client');

		await startSocialLogin('apple', '/wg/MTE8PZAT');

		expect(signInWithOAuth).toHaveBeenCalledWith({
			provider: 'apple',
			options: {
				redirectTo: 'https://manawg.test/auth/callback?next=%2Fwg%2FMTE8PZAT',
			},
		});
	});

	it('links another social identity through the same safe callback', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
		vi.stubGlobal('window', { location: { origin: 'https://manawg.test' } });
		const linkIdentity = vi.fn().mockResolvedValue({ error: null });
		createBrowserClient.mockReturnValue({ auth: { linkIdentity } });
		const { linkSocialIdentity } = await import('./client');

		await linkSocialIdentity('google', '/wg/MTE8PZAT/einstellungen#zugang');

		expect(linkIdentity).toHaveBeenCalledWith({
			provider: 'google',
			options: {
				redirectTo:
					'https://manawg.test/auth/callback?next=%2Fwg%2FMTE8PZAT%2Feinstellungen%23zugang',
			},
		});
	});

	it('ends the browser session on explicit account logout', async () => {
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
		vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
		const signOut = vi.fn().mockResolvedValue({ error: null });
		createBrowserClient.mockReturnValue({ auth: { signOut } });
		const { signOutSocialAccount } = await import('./client');

		await signOutSocialAccount();

		expect(signOut).toHaveBeenCalledOnce();
	});
});
