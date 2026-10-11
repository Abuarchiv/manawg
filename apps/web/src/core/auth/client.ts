'use client';

import { retireWebPushEndpoint } from '@/core/notifications/push-subscribe';
import { MEMBER_NAME_MAX_LENGTH } from '@/shared/lib/limits';
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

export function createSupabaseBrowserClient() {
	const { url, publishableKey } = getSupabaseEnv();
	return createBrowserClient(url, publishableKey, {
		cookieOptions: authCookieOptions(
			typeof window !== 'undefined' && window.location.protocol === 'https:',
		),
	});
}

function authCallbackUrl(next: string): string {
	const callback = new URL('/auth/callback', window.location.origin);
	callback.searchParams.set('next', safeNextPath(next));
	return callback.toString();
}

export async function startSocialLogin(provider: SocialProvider, next: string): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
		provider,
		options: { redirectTo: authCallbackUrl(next) },
	});
	if (error) throw error;
}

export async function linkSocialIdentity(provider: SocialProvider, next: string): Promise<void> {
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
	name: string,
): Promise<AuthSessionResult> {
	const { data, error } = await createSupabaseBrowserClient().auth.signUp({
		email,
		password,
		options: { emailRedirectTo: authCallbackUrl(next), data: { full_name: name } },
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

/** Display name from the account metadata (sign-up form or Google), trimmed to the member limit. */
export async function getAccountName(): Promise<string | null> {
	const { data, error } = await createSupabaseBrowserClient().auth.getUser();
	if (error || !data.user) return null;
	const meta = data.user.user_metadata as Record<string, unknown>;
	const raw = [meta.full_name, meta.name, meta.given_name].find(
		(value): value is string => typeof value === 'string' && value.trim().length > 0,
	);
	return raw ? raw.trim().slice(0, MEMBER_NAME_MAX_LENGTH) : null;
}

export async function updatePassword(password: string): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
	if (error) throw error;
}

/** Mails a one-time code to an existing account; unknown addresses are rejected instead of created. */
export async function requestEmailCode(email: string): Promise<void> {
	const { error } = await createSupabaseBrowserClient().auth.signInWithOtp({
		email,
		options: { shouldCreateUser: false },
	});
	if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string): Promise<AuthSessionResult> {
	const { data, error } = await createSupabaseBrowserClient().auth.verifyOtp({
		email,
		token,
		type: 'email',
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
	// The wipe took the offline page with it; the worker fetches it again.
	if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
		navigator.serviceWorker.controller?.postMessage('refresh-shell');
	}
}

const LOGOUT_SYNC_TIMEOUT_MS = 5_000;

/** Best effort: send what the offline queue still holds before the wipe takes it. */
async function flushOfflineQueueBeforeLogout(): Promise<number> {
	try {
		const { readOfflineQueue, syncOfflineActions, countOfflineActions } = await import(
			'@/core/offline/offline-client'
		);
		const pairs = new Map(
			readOfflineQueue().map((a) => [`${a.shareCode}:${a.memberId}`, a] as const),
		);
		if (pairs.size > 0) {
			const abort = new AbortController();
			const timeout = setTimeout(() => abort.abort(), LOGOUT_SYNC_TIMEOUT_MS);
			try {
				await Promise.race([
					Promise.all(
						[...pairs.values()].map((a) =>
							syncOfflineActions(a.shareCode, {
								force: true,
								memberId: a.memberId,
								signal: abort.signal,
							}),
						),
					),
					new Promise((resolve) => abort.signal.addEventListener('abort', resolve)),
				]);
			} finally {
				clearTimeout(timeout);
			}
		}
		return countOfflineActions();
	} catch {
		return 0;
	}
}

/**
 * `confirmDiscard` is asked when actions are still queued after a sync attempt, since the wipe
 * below deletes them; answering false keeps the session and resolves with `cancelled`.
 */
export async function signOutSocialAccount(
	pushTargets: readonly LogoutPushTarget[] = [],
	options: { confirmDiscard?: (count: number) => Promise<boolean> } = {},
): Promise<{ pushCleanup: LogoutPushCleanup; cancelled?: true }> {
	if (options.confirmDiscard) {
		const unsent = await flushOfflineQueueBeforeLogout();
		if (unsent > 0 && !(await options.confirmDiscard(unsent))) {
			return { pushCleanup: 'none', cancelled: true };
		}
	}
	const pushCleanup = await removeCurrentBrowserPushSubscription(pushTargets).catch(
		() => 'failed' as const,
	);
	const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: 'local' });
	if (error) throw error;
	await clearLocalAccountData();
	return { pushCleanup };
}
