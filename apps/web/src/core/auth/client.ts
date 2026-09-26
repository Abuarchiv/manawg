'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnv } from './env';
import { safeNextPath } from './next-path';

export type SocialProvider = 'google';

export type AuthSessionResult = {
	sessionEstablished: boolean;
};

const PHONE_PROVIDER_UNAVAILABLE_CODES = new Set(['phone_provider_disabled', 'provider_disabled']);

/** Public Supabase error codes that mean SMS auth is unavailable, not invalid input. */
export function isPhoneAuthUnavailable(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const code = Reflect.get(error, 'code');
	return typeof code === 'string' && PHONE_PROVIDER_UNAVAILABLE_CODES.has(code);
}

export function createSupabaseBrowserClient() {
	const { url, publishableKey } = getSupabaseEnv();
	return createBrowserClient(url, publishableKey);
}

export async function isAuthProviderEnabled(provider: SocialProvider | 'phone'): Promise<boolean> {
	const { url, publishableKey } = getSupabaseEnv();
	const response = await fetch(new URL('/auth/v1/settings', url), {
		headers: { apikey: publishableKey },
		cache: 'no-store',
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new Error('auth_unavailable');
	const settings = (await response.json()) as { external?: Record<string, boolean> };
	return settings.external?.[provider] === true;
}

async function requireEnabledProvider(provider: SocialProvider): Promise<void> {
	if (!(await isAuthProviderEnabled(provider))) throw new Error('provider_unavailable');
}

function authCallbackUrl(next: string): string {
	const callback = new URL('/auth/callback', window.location.origin);
	callback.searchParams.set('next', safeNextPath(next));
	return callback.toString();
}

export async function startSocialLogin(provider: SocialProvider, next: string): Promise<void> {
	await requireEnabledProvider(provider);
	const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
		provider,
		options: { redirectTo: authCallbackUrl(next) },
	});
	if (error) throw error;
}

export async function linkSocialIdentity(provider: SocialProvider, next: string): Promise<void> {
	await requireEnabledProvider(provider);
	const { error } = await createSupabaseBrowserClient().auth.linkIdentity({
		provider,
		options: { redirectTo: authCallbackUrl(next) },
	});
	if (error) throw error;
}

export async function signInWithEmailPassword(
	email: string,
	password: string,
): Promise<AuthSessionResult> {
	const { data, error } = await createSupabaseBrowserClient().auth.signInWithPassword({
		email,
		password,
	});
	if (error) throw error;
	return { sessionEstablished: data.session !== null };
}

export async function signUpWithEmailPassword(
	email: string,
	password: string,
	next: string,
): Promise<AuthSessionResult> {
	const { data, error } = await createSupabaseBrowserClient().auth.signUp({
		email,
		password,
		options: { emailRedirectTo: authCallbackUrl(next) },
	});
	if (error) throw error;
	return { sessionEstablished: data.session !== null };
}

export async function requestPasswordReset(email: string): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
		redirectTo: authCallbackUrl('/auth/reset'),
	});
	if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
	if (error) throw error;
}

export async function requestPhoneOtp(phone: string): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.signInWithOtp({
		phone,
		options: { shouldCreateUser: true },
	});
	if (error) throw error;
}

export async function verifyPhoneOtp(phone: string, token: string): Promise<AuthSessionResult> {
	const { data, error } = await createSupabaseBrowserClient().auth.verifyOtp({
		phone,
		token,
		type: 'sms',
	});
	if (error) throw error;
	return { sessionEstablished: data.session !== null };
}

export async function signOutSocialAccount(): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: 'local' });
	if (error) throw error;
}
