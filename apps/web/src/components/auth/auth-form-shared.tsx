import { type ReactElement, useEffect, useState } from 'react';
import { ErrorBox } from '@/components/app/ErrorBox';
import { AUTH_FAILURE_MESSAGES, type AuthFailure } from '@/core/auth/password-errors';
import { type Message, useMessage } from '@/shared/i18n/message';

export { isValidEmail } from './email-format';

/** The request in flight; one at a time across all sign-in forms. */
export type BusyAction =
	| 'email-sign-in'
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
	fallback = { key: 'auth.failure.signIn' },
}: {
	failure?: AuthFailure;
	fallback?: Message;
}): ReactElement {
	const message = useMessage();
	return (
		<ErrorBox>{message(failure === 'other' ? fallback : AUTH_FAILURE_MESSAGES[failure])}</ErrorBox>
	);
}
