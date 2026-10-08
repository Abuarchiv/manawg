'use client';

import { ErrorBox } from '@/components/app/ErrorBox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { type AuthFailure, classifyAuthError } from '@/core/auth/password-errors';
import { useEffect, useState } from 'react';
import {
	type AuthFormProps,
	type BusyAction,
	GenericAuthError,
	isValidEmail,
} from './auth-form-shared';

const RESEND_COOLDOWN_SECONDS = 60;

/** E-mail and password: sign in, resend a confirmation mail, or request a reset link. */
export function useEmailAuth({
	next,
	busy,
	setBusy,
	onAuthenticated,
}: AuthFormProps & { next: string }) {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [emailError, setEmailError] = useState<'generic' | 'invalid' | 'reset-invalid' | null>(
		null,
	);
	const [failure, setFailure] = useState<AuthFailure>('other');
	const [emailMessage, setEmailMessage] = useState<string | null>(null);
	// Kept across sign-in attempts, so repeating the failed sign-in cannot mail again at once.
	const [resendCooldown, setResendCooldown] = useState(0);

	useEffect(() => {
		if (resendCooldown <= 0) return;
		const timer = setTimeout(() => setResendCooldown((value) => value - 1), 1000);
		return () => clearTimeout(timer);
	}, [resendCooldown]);

	function resetEmailFeedback(): void {
		setFailure('other');
		setEmailError(null);
		setEmailMessage(null);
	}

	async function submitEmail(): Promise<void> {
		if (busy) return;
		resetEmailFeedback();
		const normalizedEmail = email.trim().toLowerCase();
		// Existing accounts may still use 6-character passwords, so sign-in only
		// requires the old minimum.
		if (!isValidEmail(normalizedEmail) || password.length < 6) {
			setEmailError('invalid');
			return;
		}
		setBusy('email-sign-in');
		try {
			const { signInWithEmailPassword } = await import('@/core/auth/client');
			const result = await signInWithEmailPassword(normalizedEmail, password);
			if (result.sessionEstablished) {
				onAuthenticated();
			} else {
				setEmailMessage(
					'Die Anmeldung ist noch nicht abgeschlossen. Prüfe deine E-Mail und versuche es erneut.',
				);
			}
		} catch (error) {
			setFailure(classifyAuthError(error));
			setEmailError('generic');
		} finally {
			setBusy(null);
		}
	}

	async function resendConfirmation(): Promise<void> {
		if (busy || resendCooldown > 0) return;
		const normalizedEmail = email.trim().toLowerCase();
		resetEmailFeedback();
		if (!isValidEmail(normalizedEmail)) {
			setEmailError('reset-invalid');
			return;
		}
		setBusy('email-resend');
		try {
			const { resendSignupConfirmation } = await import('@/core/auth/client');
			await resendSignupConfirmation(normalizedEmail, next);
			setResendCooldown(RESEND_COOLDOWN_SECONDS);
			setEmailMessage(
				'Wir haben die Bestätigungs-Mail erneut gesendet, sofern diese Adresse auf eine Bestätigung wartet. Schau auch im Spam-Ordner nach.',
			);
		} catch (error) {
			setFailure(classifyAuthError(error));
			setEmailError('generic');
		} finally {
			setBusy(null);
		}
	}

	async function requestPasswordReset(): Promise<void> {
		if (busy) return;
		resetEmailFeedback();
		const normalizedEmail = email.trim().toLowerCase();
		if (!isValidEmail(normalizedEmail)) {
			setEmailError('reset-invalid');
			return;
		}
		setBusy('password-reset');
		try {
			const { requestPasswordReset: sendPasswordReset } = await import('@/core/auth/client');
			await sendPasswordReset(normalizedEmail);
			setEmailMessage(
				'Wenn zu dieser E-Mail-Adresse ein Konto gehört, erhältst du gleich einen Link zum Zurücksetzen des Passworts.',
			);
		} catch (error) {
			setFailure(classifyAuthError(error));
			setEmailError('generic');
		} finally {
			setBusy(null);
		}
	}

	const emailFieldInvalid =
		emailError === 'reset-invalid' ||
		(emailError === 'invalid' && !isValidEmail(email.trim().toLowerCase()));
	const passwordFieldInvalid = emailError === 'invalid' && password.length < 6;

	return {
		email,
		setEmail,
		password,
		setPassword,
		emailError,
		failure,
		emailMessage,
		submitEmail,
		resendConfirmation,
		resendCooldown,
		requestPasswordReset,
		emailFieldInvalid,
		passwordFieldInvalid,
	};
}

export function EmailAuthForm({
	auth,
	busy,
}: { auth: ReturnType<typeof useEmailAuth>; busy: BusyAction }) {
	const {
		email,
		setEmail,
		password,
		setPassword,
		emailError,
		failure,
		emailMessage,
		submitEmail,
		resendConfirmation,
		resendCooldown,
		requestPasswordReset,
		emailFieldInvalid,
		passwordFieldInvalid,
	} = auth;
	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void submitEmail();
			}}
			className="flex flex-col gap-4"
		>
			<FieldGroup>
				<Field data-invalid={emailFieldInvalid}>
					<FieldLabel htmlFor="auth-email">E-Mail-Adresse</FieldLabel>
					<Input
						id="auth-email"
						name="email"
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						readOnly={busy !== null}
						autoComplete="email"
						enterKeyHint="next"
						inputMode="email"
						required
						aria-describedby={emailFieldInvalid ? 'auth-email-error' : undefined}
						aria-invalid={emailFieldInvalid || undefined}
						className="text-base"
					/>
				</Field>
				<Field data-invalid={passwordFieldInvalid}>
					<FieldLabel htmlFor="auth-password">Passwort</FieldLabel>
					<Input
						id="auth-password"
						name="password"
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						readOnly={busy !== null}
						autoComplete="current-password"
						enterKeyHint="go"
						minLength={6}
						required
						aria-describedby={passwordFieldInvalid ? 'auth-email-error' : undefined}
						aria-invalid={passwordFieldInvalid || undefined}
						className="text-base"
					/>
				</Field>
				{emailError === 'generic' && (
					<div id="auth-email-error">
						<GenericAuthError failure={failure} />
					</div>
				)}
				{emailError === 'invalid' && (
					<div id="auth-email-error">
						<ErrorBox>Bitte gib eine gültige E-Mail-Adresse und dein Passwort ein.</ErrorBox>
					</div>
				)}
				{emailError === 'reset-invalid' && (
					<div id="auth-email-error">
						<ErrorBox>Bitte gib eine gültige E-Mail-Adresse ein.</ErrorBox>
					</div>
				)}
				<Button
					type="button"
					variant="link"
					onClick={() => void requestPasswordReset()}
					disabled={busy !== null}
					className="px-0"
				>
					{busy === 'password-reset' ? 'Link wird angefordert…' : 'Passwort vergessen?'}
				</Button>
				{emailMessage && (
					<Alert>
						<AlertDescription className="[overflow-wrap:break-word]">
							{emailMessage}
						</AlertDescription>
					</Alert>
				)}
				{failure === 'unconfirmed' && emailError === 'generic' && (
					<Button
						type="button"
						variant="outline"
						onClick={() => void resendConfirmation()}
						disabled={busy !== null || resendCooldown > 0}
					>
						{busy === 'email-resend' && <Spinner data-icon="inline-start" aria-hidden />}
						{resendCooldown > 0
							? `Erneut senden in ${resendCooldown} s`
							: 'Bestätigungs-Mail erneut senden'}
					</Button>
				)}
				<Button type="submit" variant="default" disabled={busy !== null}>
					{busy === 'email-sign-in' && <Spinner data-icon="inline-start" aria-hidden />}
					Anmelden
				</Button>
			</FieldGroup>
		</form>
	);
}
