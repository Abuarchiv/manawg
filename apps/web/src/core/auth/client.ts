'use client';

import { apiFetch } from '@/core/infra/api-client';
import { retireWebPushEndpoint } from '@/core/notifications/push-subscribe';

// The session lives in HttpOnly cookies that only the server reads and writes. Every call below
// goes through /api/auth/*; there is no Supabase client in the browser.

export type SocialProvider = 'google';

export type AuthSessionResult = {
	sessionEstablished: boolean;
};

export type LogoutPushTarget = {
	code: string;
	memberId: string;
};

export type LogoutPushCleanup = 'none' | 'unsubscribed' | 'failed';

/** An auth route failure; `code` is the Supabase error code (e.g. `invalid_credentials`). */
class AuthRequestError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(code: string, status: number) {
		super(code);
		// classifyAuthError reads these three fields.
		this.name = status === 0 || status === 503 ? 'AuthRetryableFetchError' : 'AuthApiError';
		this.code = code;
		this.status = status;
	}
}

async function authRequest<T>(path: string, body?: object): Promise<T> {
	const res = await apiFetch<T>(
		path,
		body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) },
	);
	if (!res.ok)
		throw new AuthRequestError(res.status === 0 ? 'network_error' : res.error, res.status);
	return res.data;
}

async function followProviderUrl(
	path: string,
	provider: SocialProvider,
	next: string,
): Promise<void> {
	const { url } = await authRequest<{ url: string }>(path, { provider, next });
	window.location.assign(url);
}

export function startSocialLogin(provider: SocialProvider, next: string): Promise<void> {
	return followProviderUrl('/api/auth/oauth-start', provider, next);
}

export function linkSocialIdentity(provider: SocialProvider, next: string): Promise<void> {
	return followProviderUrl('/api/auth/identity-link', provider, next);
}

type AccountInfo = {
	email: string | null;
	hasPassword: boolean;
	hasGoogle: boolean;
	name: string | null;
};

const readAccount = () => authRequest<AccountInfo>('/api/auth/identities');

/** Whether the signed-in account already has this provider attached (linking it again fails). */
export async function hasLinkedIdentity(provider: SocialProvider): Promise<boolean> {
	const account = await readAccount();
	return provider === 'google' && account.hasGoogle;
}

export function signInWithEmailPassword(
	email: string,
	password: string,
): Promise<AuthSessionResult> {
	return authRequest('/api/auth/sign-in', { email, password });
}

export function signUpWithEmailPassword(
	email: string,
	password: string,
	next: string,
	name: string,
): Promise<AuthSessionResult> {
	return authRequest('/api/auth/sign-up', { email, password, next, name });
}

/** Sends the sign-up confirmation mail again; the response never reveals whether the address exists. */
export async function resendSignupConfirmation(email: string, next: string): Promise<void> {
	await authRequest('/api/auth/resend', { email, next });
}

export async function requestPasswordReset(email: string): Promise<void> {
	await authRequest('/api/auth/password-reset', { email });
}

/** The signed-in account's e-mail and whether it signs in with an e-mail/password identity. */
export async function getEmailAccount(): Promise<{ email: string; hasPassword: boolean } | null> {
	const account = await readAccount().catch(() => null);
	return account?.email ? { email: account.email, hasPassword: account.hasPassword } : null;
}

/** Display name from the account metadata (sign-up form or Google), trimmed to the member limit. */
export async function getAccountName(): Promise<string | null> {
	return (await readAccount().catch(() => null))?.name ?? null;
}

/** Asks for an e-mail change; the address only changes once the link in the mail is opened. */
export async function requestEmailChange(email: string, next: string): Promise<void> {
	await authRequest('/api/auth/email', { email, next });
}

export async function updatePassword(password: string): Promise<void> {
	await authRequest('/api/auth/password', { password });
}

/** Mails a one-time code to an existing account; unknown addresses are rejected instead of created. */
export async function requestEmailCode(email: string): Promise<void> {
	await authRequest('/api/auth/code-request', { email });
}

export function verifyEmailCode(email: string, token: string): Promise<AuthSessionResult> {
	return authRequest('/api/auth/code-verify', { email, token });
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
	options: { confirmDiscard?: (count: number) => Promise<boolean>; everywhere?: boolean } = {},
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
	await authRequest('/api/auth/sign-out', options.everywhere ? { everywhere: true } : {});
	await clearLocalAccountData();
	return { pushCleanup };
}
