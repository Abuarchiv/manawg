import type { Message } from '@/shared/i18n/message';

export const WEAK_PASSWORD_MESSAGE: Message = { key: 'auth.failure.weakPassword' };

export type AuthFailure = 'credentials' | 'unconfirmed' | 'rate-limit' | 'network' | 'other';

const RATE_LIMIT_CODES = new Set([
	'over_request_rate_limit',
	'over_email_send_rate_limit',
	'over_sms_send_rate_limit',
]);

/** Map a Supabase Auth error to the cases that need their own message. */
export function classifyAuthError(error: unknown): AuthFailure {
	if (error === null || typeof error !== 'object') return 'other';
	const code = Reflect.get(error, 'code');
	const status = Reflect.get(error, 'status');
	if (status === 429 || (typeof code === 'string' && RATE_LIMIT_CODES.has(code))) {
		return 'rate-limit';
	}
	if (code === 'invalid_credentials') return 'credentials';
	if (code === 'email_not_confirmed') return 'unconfirmed';
	if (Reflect.get(error, 'name') === 'AuthRetryableFetchError') return 'network';
	return 'other';
}

export const AUTH_RATE_LIMITED_MESSAGE: Message = { key: 'auth.failure.rateLimit' };

export const AUTH_FAILURE_MESSAGES: Record<Exclude<AuthFailure, 'other'>, Message> = {
	credentials: { key: 'auth.failure.credentials' },
	unconfirmed: { key: 'auth.failure.unconfirmed' },
	'rate-limit': AUTH_RATE_LIMITED_MESSAGE,
	network: { key: 'auth.failure.network' },
};

export function isWeakPasswordError(error: unknown): boolean {
	return (
		error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'weak_password'
	);
}

export function isSamePasswordError(error: unknown): boolean {
	return (
		error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'same_password'
	);
}
