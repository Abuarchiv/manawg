'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnv } from './env';
import { safeNextPath } from './next-path';

export type SocialProvider = 'google' | 'apple' | 'facebook';

export function createSupabaseBrowserClient() {
	const { url, publishableKey } = getSupabaseEnv();
	return createBrowserClient(url, publishableKey);
}

async function requireEnabledProvider(provider: SocialProvider): Promise<void> {
	const { url, publishableKey } = getSupabaseEnv();
	const response = await fetch(new URL('/auth/v1/settings', url), {
		headers: { apikey: publishableKey },
		cache: 'no-store',
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new Error('auth_unavailable');
	const settings = (await response.json()) as { external?: Record<string, boolean> };
	if (settings.external?.[provider] !== true) throw new Error('provider_unavailable');
}

export async function startSocialLogin(provider: SocialProvider, next: string): Promise<void> {
	await requireEnabledProvider(provider);
	const callback = new URL('/auth/callback', window.location.origin);
	callback.searchParams.set('next', safeNextPath(next));
	const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
		provider,
		options: { redirectTo: callback.toString() },
	});
	if (error) throw error;
}

export async function linkSocialIdentity(provider: SocialProvider, next: string): Promise<void> {
	await requireEnabledProvider(provider);
	const callback = new URL('/auth/callback', window.location.origin);
	callback.searchParams.set('next', safeNextPath(next));
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
