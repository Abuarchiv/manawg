'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnv } from './env';

export type SocialProvider = 'google' | 'apple' | 'facebook';

export function createSupabaseBrowserClient() {
	const { url, publishableKey } = getSupabaseEnv();
	return createBrowserClient(url, publishableKey);
}

export async function startSocialLogin(provider: SocialProvider, next: string): Promise<void> {
	const callback = new URL('/auth/callback', window.location.origin);
	callback.searchParams.set('next', next);
	const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
		provider,
		options: { redirectTo: callback.toString() },
	});
	if (error) throw error;
}

export async function linkSocialIdentity(provider: SocialProvider, next: string): Promise<void> {
	const callback = new URL('/auth/callback', window.location.origin);
	callback.searchParams.set('next', next);
	const { error } = await createSupabaseBrowserClient().auth.linkIdentity({
		provider,
		options: { redirectTo: callback.toString() },
	});
	if (error) throw error;
}

export async function signOutSocialAccount(): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: 'local' });
	if (error) throw error;
}
