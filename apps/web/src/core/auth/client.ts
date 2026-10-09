'use client';

import { retireWebPushEndpoint } from '@/core/notifications/push-subscribe';
import { createBrowserClient } from '@supabase/ssr';
import { authCookieOptions } from './cookie-options';
import { safeNextPath } from './next-path';
import { getSupabaseEnv } from './supabase-env';

export type SocialProvider = 'google';

export type AuthSessionResult = {
	sessionEstablished: boolean;
};

export type LogoutPushTarget = {
	code: string;
	memberId: string;
};

export type LogoutPushCleanup = 'none' | 'unsubscribed' | 'failed';

const PHONE_PROVIDER_UNAVAILABLE_CODES = new Set(['phone_provider_disabled', 'provider_disabled']);

/** Public Supabase error codes that mean SMS auth is unavailable, not invalid input. */
export function isPhoneAuthUnavailable(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const code = Reflect.get(error, 'code');
	return typeof code === 'string' && PHONE_PROVIDER_UNAVAILABLE_CODES.has(code);
}

export function createSupabaseBrowserClient() {
	const { url, publishableKey } = getSupabaseEnv();
	return createBrowserClient(url, publishableKey, {
		cookieOptions: authCookieOptions(window.location.protocol === 'https:'),
	});
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

/** Whether the signed-in account already has this provider attached (linking it again fails). */
export async function hasLinkedIdentity(provider: SocialProvider): Promise<boolean> {
	const { data, error } = await createSupabaseBrowserClient().auth.getUserIdentities();
	if (error) throw error;
	return data.identities.some((identity) => identity.provider === provider);
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

/** Sends the sign-up confirmation mail again; the response never reveals whether the address exists. */
export async function resendSignupConfirmation(email: string, next: string): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.resend({
		type: 'signup',
		email,
		options: { emailRedirectTo: authCallbackUrl(next) },
	});
	if (error) throw error;
}

export async function requestPasswordReset(email: string): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
		redirectTo: authCallbackUrl('/auth/reset'),
	});
	if (error) throw error;
}

/** The signed-in account's e-mail and whether it signs in with an e-mail/password identity. */
export async function getEmailAccount(): Promise<{ email: string; hasPassword: boolean } | null> {
	const { data, error } = await createSupabaseBrowserClient().auth.getUser();
	if (error || !data.user?.email) return null;
	const hasPassword = (data.user.identities ?? []).some(
		(identity) => identity.provider === 'email',
	);
	return { email: data.user.email, hasPassword };
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

async function removeCurrentBrowserPushSubscription(
	targets: readonly LogoutPushTarget[],
): Promise<LogoutPushCleanup> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'none';

	let registration: ServiceWorkerRegistration | undefined;
	try {
		registration = await navigator.serviceWorker.getRegistration();
	} catch {
		console.warn('[auth] browser push subscription could not be inspected during logout');
		return 'failed';
	}
	if (!registration) return 'none';
	if (!registration.pushManager) return 'none';

	let subscription: PushSubscription | null;
	try {
		subscription = await registration.pushManager.getSubscription();
	} catch {
		console.warn('[auth] browser push subscription could not be inspected during logout');
		return 'failed';
	}
	if (!subscription) return 'none';

	const uniqueTargets = [
		...new Map(targets.map((target) => [`${target.code}:${target.memberId}`, target])).values(),
	];
	const serverCleanup = Promise.allSettled(
		uniqueTargets.map((target) =>
			retireWebPushEndpoint(target.code, target.memberId, subscription.endpoint),
		),
	);
	let locallyUnsubscribed = false;
	let unsubscribeTimeout: ReturnType<typeof setTimeout> | undefined;
	try {
		locallyUnsubscribed = await Promise.race([
			subscription.unsubscribe().catch(() => false),
			new Promise<false>((resolve) => {
				unsubscribeTimeout = setTimeout(() => resolve(false), 3_000);
			}),
		]);
	} catch {
		locallyUnsubscribed = false;
	} finally {
		if (unsubscribeTimeout) clearTimeout(unsubscribeTimeout);
	}
	const serverResults = await serverCleanup;
	const serverCleanupSucceeded =
		uniqueTargets.length > 0 && serverResults.every((result) => result.status === 'fulfilled');
	if (!locallyUnsubscribed) {
		console.warn('[auth] browser push subscription could not be retired during logout');
		return 'failed';
	}
	if (!serverCleanupSucceeded && uniqueTargets.length > 0) {
		console.warn('[auth] browser push endpoint cleanup request failed during logout');
	}
	return 'unsubscribed';
}

/**
 * Remove everything this browser stored for the signed-out account: identities,
 * drafts, offline queue, pending images, shell caches. Theme stays (device preference).
 */
export async function clearLocalAccountData(): Promise<void> {
	try {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith('manawg:') || key.startsWith('manawg_')) localStorage.removeItem(key);
		}
	} catch {
		// Blocked storage has nothing to leak.
	}
	await Promise.allSettled([
		typeof indexedDB === 'undefined'
			? undefined
			: new Promise<void>((resolve) => {
					const request = indexedDB.deleteDatabase('manawg-offline-images');
					request.onsuccess = request.onerror = request.onblocked = () => resolve();
				}),
		typeof caches === 'undefined'
			? undefined
			: caches
					.keys()
					.then((keys) =>
						Promise.all(
							keys.filter((key) => key.startsWith('manawg-app-')).map((key) => caches.delete(key)),
						),
					),
	]);
}

export async function signOutSocialAccount(
	pushTargets: readonly LogoutPushTarget[] = [],
): Promise<{ pushCleanup: LogoutPushCleanup }> {
	const pushCleanup = await removeCurrentBrowserPushSubscription(pushTargets).catch(
		() => 'failed' as const,
	);
	const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: 'local' });
	if (error) throw error;
	await clearLocalAccountData();
	return { pushCleanup };
}
