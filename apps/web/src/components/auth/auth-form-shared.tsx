import { ErrorBox } from '@/components/app/ErrorBox';
import { AUTH_FAILURE_MESSAGES, type AuthFailure } from '@/core/auth/password-errors';
import type { ReactElement } from 'react';

/** Minimum for passwords chosen now (sign-up, reset); Supabase enforces the same value. */
export const NEW_PASSWORD_MIN_LENGTH = 8;

/** The request in flight; one at a time across e-mail and phone sign-in. */
export type BusyAction =
	| 'email-sign-in'
	| 'email-sign-up'
	| 'password-reset'
	| 'phone-request'
	| 'phone-verify'
	| null;

export interface AuthFormProps {
	busy: BusyAction;
	setBusy: (action: BusyAction) => void;
	onAuthenticated: () => void;
}

export function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function GenericAuthError({ failure = 'other' }: { failure?: AuthFailure }): ReactElement {
	return (
		<ErrorBox>
			{failure === 'other'
				? 'Die Anmeldung konnte gerade nicht abgeschlossen werden. Bitte versuche es erneut.'
				: AUTH_FAILURE_MESSAGES[failure]}
		</ErrorBox>
	);
}
