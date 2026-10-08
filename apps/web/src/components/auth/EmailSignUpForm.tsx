'use client';

import { ErrorBox } from '@/components/app/ErrorBox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
	type AuthFailure,
	WEAK_PASSWORD_MESSAGE,
	classifyAuthError,
	isWeakPasswordError,
} from '@/core/auth/password-errors';
import { useEffect, useRef, useState } from 'react';
import {
	type AuthFormProps,
	type BusyAction,
	GenericAuthError,
	NEW_PASSWORD_MIN_LENGTH,
	isValidEmail,
} from './auth-form-shared';

/** Seconds before the confirmation mail can be requested again; the server limits stay authoritative. */
const RESEND_COOLDOWN_SECONDS = 60;

type SignUpError = 'invalid' | 'too-short' | 'mismatch' | 'weak-password' | 'generic' | null;

/** E-mail registration: validates locally, then waits for the confirmation mail when required. */
export function useEmailSignUp({
	next,
	busy,
	setBusy,
	onAuthenticated,
}: AuthFormProps & { next: string }) {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirmation, setConfirmation] = useState('');
	const [error, setError] = useState<SignUpError>(null);
	const [failure, setFailure] = useState<AuthFailure>('other');
	// The address the confirmation mail went to; set means the inbox state is shown.
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [cooldown, setCooldown] = useState(0);
	const [resendNotice, setResendNotice] = useState(false);

	useEffect(() => {
		if (cooldown <= 0) return;
		const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
		return () => clearTimeout(timer);
	}, [cooldown]);

	function clearFeedback(): void {
		setError(null);
		setFailure('other');
		setResendNotice(false);
	}

	async function submit(): Promise<void> {
		if (busy) return;
		clearFeedback();
		const normalizedEmail = email.trim().toLowerCase();
		if (!isValidEmail(normalizedEmail)) {
			setError('invalid');
			return;
		}
		if (password.length < NEW_PASSWORD_MIN_LENGTH) {
			setError('too-short');
			return;
		}
		if (password !== confirmation) {
			setError('mismatch');
			return;
		}
		setBusy('email-sign-up');
		try {
			const { signUpWithEmailPassword } = await import('@/core/auth/client');
			const result = await signUpWithEmailPassword(normalizedEmail, password, next);
			if (result.sessionEstablished) {
				onAuthenticated();
				return;
			}
			// Supabase answers alike for new and existing addresses, so the copy stays conditional.
			setPassword('');
			setConfirmation('');
			setSentTo(normalizedEmail);
			setCooldown(RESEND_COOLDOWN_SECONDS);
		} catch (caught) {
			setFailure(classifyAuthError(caught));
			setError(isWeakPasswordError(caught) ? 'weak-password' : 'generic');
		} finally {
			setBusy(null);
		}
	}

	async function resend(): Promise<void> {
		if (busy || !sentTo || cooldown > 0) return;
		clearFeedback();
		setBusy('email-resend');
		try {
			const { resendSignupConfirmation } = await import('@/core/auth/client');
			await resendSignupConfirmation(sentTo, next);
			setResendNotice(true);
			setCooldown(RESEND_COOLDOWN_SECONDS);
		} catch (caught) {
			setFailure(classifyAuthError(caught));
			setError('generic');
		} finally {
			setBusy(null);
		}
	}

	function useOtherAddress(): void {
		clearFeedback();
		setSentTo(null);
		setCooldown(0);
	}

	return {
		email,
		setEmail,
		password,
		setPassword,
		confirmation,
		setConfirmation,
		error,
		failure,
		sentTo,
		cooldown,
		resendNotice,
		submit,
		resend,
		useOtherAddress,
	};
}

function InboxNotice({
	auth,
	busy,
}: { auth: ReturnType<typeof useEmailSignUp>; busy: BusyAction }) {
	const { sentTo, cooldown, resendNotice, error, failure, resend, useOtherAddress } = auth;
	const titleRef = useRef<HTMLDivElement>(null);
	// The form was replaced by this notice, so keyboard and screen reader users land on it.
	useEffect(() => {
		titleRef.current?.focus();
	}, []);
	return (
		<div className="flex flex-col gap-4">
			<Alert>
				<AlertTitle ref={titleRef} tabIndex={-1} className="focus:outline-none">
					Prüfe dein Postfach
				</AlertTitle>
				<AlertDescription className="[overflow-wrap:anywhere]">
					Wir haben einen Bestätigungslink an {sentTo} geschickt, sofern für diese Adresse noch kein
					Konto besteht. Öffne den Link, danach geht es hier weiter. Schau auch im Spam-Ordner nach.
					Hast du schon ein Konto, melde dich stattdessen an.
				</AlertDescription>
			</Alert>
			{resendNotice && (
				<output className="text-sm text-muted-foreground">Die E-Mail wurde erneut gesendet.</output>
			)}
			{error === 'generic' && <GenericAuthError failure={failure} fallback={SIGN_UP_FAILED} />}
			<div className="flex flex-col gap-2">
				<Button
					type="button"
					variant="outline"
					onClick={() => void resend()}
					disabled={busy !== null || cooldown > 0}
				>
					{busy === 'email-resend' && <Spinner data-icon="inline-start" aria-hidden />}
					{cooldown > 0 ? `Erneut senden in ${cooldown} s` : 'E-Mail erneut senden'}
				</Button>
				<Button type="button" variant="ghost" onClick={useOtherAddress} disabled={busy !== null}>
					Andere E-Mail-Adresse verwenden
				</Button>
			</div>
		</div>
	);
}

const SIGN_UP_FAILED =
	'Die Registrierung konnte gerade nicht abgeschlossen werden. Bitte versuche es erneut.';

const ERROR_MESSAGES = {
	invalid: 'Bitte gib eine gültige E-Mail-Adresse ein.',
	'too-short': `Dein Passwort braucht mindestens ${NEW_PASSWORD_MIN_LENGTH} Zeichen.`,
	mismatch: 'Die Passwörter stimmen nicht überein.',
	'weak-password': WEAK_PASSWORD_MESSAGE,
} as const;

export function EmailSignUpForm({
	auth,
	busy,
}: { auth: ReturnType<typeof useEmailSignUp>; busy: BusyAction }) {
	const { email, setEmail, password, setPassword, confirmation, setConfirmation, error, failure } =
		auth;
	if (auth.sentTo) return <InboxNotice auth={auth} busy={busy} />;

	const emailInvalid = error === 'invalid';
	const passwordInvalid = error === 'too-short' || error === 'weak-password';
	const confirmationInvalid = error === 'mismatch';
	const describedBy = (invalid: boolean, hint?: string) =>
		[hint, invalid ? 'signup-error' : undefined].filter(Boolean).join(' ') || undefined;

	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void auth.submit();
			}}
			className="flex flex-col gap-4"
		>
			<FieldGroup>
				<Field data-invalid={emailInvalid}>
					<FieldLabel htmlFor="signup-email">E-Mail-Adresse</FieldLabel>
					<Input
						id="signup-email"
						name="email"
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						readOnly={busy !== null}
						autoComplete="email"
						enterKeyHint="next"
						inputMode="email"
						required
						aria-describedby={describedBy(emailInvalid)}
						aria-invalid={emailInvalid || undefined}
						className="text-base"
					/>
				</Field>
				<Field data-invalid={passwordInvalid}>
					<FieldLabel htmlFor="signup-password">Passwort</FieldLabel>
					<Input
						id="signup-password"
						name="new-password"
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						readOnly={busy !== null}
						autoComplete="new-password"
						enterKeyHint="next"
						minLength={NEW_PASSWORD_MIN_LENGTH}
						required
						aria-describedby={describedBy(passwordInvalid, 'signup-password-hint')}
						aria-invalid={passwordInvalid || undefined}
						className="text-base"
					/>
					<FieldDescription id="signup-password-hint" className="text-xs">
						Mindestens {NEW_PASSWORD_MIN_LENGTH} Zeichen.
					</FieldDescription>
				</Field>
				<Field data-invalid={confirmationInvalid}>
					<FieldLabel htmlFor="signup-password-confirmation">Passwort wiederholen</FieldLabel>
					<Input
						id="signup-password-confirmation"
						name="new-password-confirmation"
						type="password"
						value={confirmation}
						onChange={(event) => setConfirmation(event.target.value)}
						readOnly={busy !== null}
						autoComplete="new-password"
						enterKeyHint="go"
						required
						aria-describedby={describedBy(confirmationInvalid)}
						aria-invalid={confirmationInvalid || undefined}
						className="text-base"
					/>
				</Field>
				{error === 'generic' && (
					<div id="signup-error">
						<GenericAuthError failure={failure} fallback={SIGN_UP_FAILED} />
					</div>
				)}
				{error && error !== 'generic' && (
					<div id="signup-error">
						<ErrorBox>{ERROR_MESSAGES[error]}</ErrorBox>
					</div>
				)}
				<Button type="submit" variant="default" disabled={busy !== null}>
					{busy === 'email-sign-up' && <Spinner data-icon="inline-start" aria-hidden />}
					Konto erstellen
				</Button>
			</FieldGroup>
		</form>
	);
}
