import { ErrorBox } from '@/components/app/ErrorBox';
import { AUTH_FAILURE_MESSAGES, type AuthFailure } from '@/core/auth/password-errors';
import { type ReactElement, useEffect, useState } from 'react';

/** Minimum for passwords chosen now (sign-up, reset); Supabase enforces the same value. */
export const NEW_PASSWORD_MIN_LENGTH = 8;

/**
 * Minimum for signing in. Accounts created before the minimum was raised may still use
 * 6 characters, so it stays lower than NEW_PASSWORD_MIN_LENGTH.
 */
export const SIGN_IN_PASSWORD_MIN_LENGTH = 6;

/** The request in flight; one at a time across all sign-in forms. */
export type BusyAction =
	| 'email-sign-in'
	| 'email-sign-up'
	| 'email-resend'
	| 'password-reset'
	| 'code-request'
	| 'code-verify'
	| null;

export interface AuthFormProps {
	busy: BusyAction;
	setBusy: (action: BusyAction) => void;
	onAuthenticated: () => void;
}

export function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Lower-cased, trimmed address as the auth endpoints expect it. */
export function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

/** Seconds left before a mail can be requested again; set a value to start the countdown. */
export function useResendCooldown(): [number, (seconds: number) => void] {
	const [remaining, setRemaining] = useState(0);
	useEffect(() => {
		if (remaining <= 0) return;
		const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
		return () => clearTimeout(timer);
	}, [remaining]);
	return [remaining, setRemaining];
}

export function GenericAuthError({
	failure = 'other',
	fallback = 'Die Anmeldung konnte gerade nicht abgeschlossen werden. Bitte versuche es erneut.',
}: { failure?: AuthFailure; fallback?: string }): ReactElement {
	return <ErrorBox>{failure === 'other' ? fallback : AUTH_FAILURE_MESSAGES[failure]}</ErrorBox>;
}
