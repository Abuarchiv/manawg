'use client';

import { ErrorBox } from '@/components/app/ErrorBox';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { useState } from 'react';
import {
	type AuthFormProps,
	type BusyAction,
	GenericAuthError,
	NEW_PASSWORD_MIN_LENGTH,
	isValidEmail,
} from './auth-form-shared';

/** E-mail and password: sign in, create an account, or request a reset link. */
export function useEmailAuth({
	next,
	busy,
	setBusy,
	onAuthenticated,
}: AuthFormProps & { next: string }) {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	// Tells password managers to offer a generated/new password once the user heads for
	// "Konto erstellen"; the sign-in path keeps current-password until then.
	const [newAccountIntent, setNewAccountIntent] = useState(false);
	const [emailError, setEmailError] = useState<
		'generic' | 'invalid' | 'too-short' | 'weak-password' | 'reset-invalid' | null
	>(null);
	const [failure, setFailure] = useState<AuthFailure>('other');
	const [emailMessage, setEmailMessage] = useState<string | null>(null);

	function resetEmailFeedback(): void {
		setFailure('other');
		setEmailError(null);
		setEmailMessage(null);
	}

	async function submitEmail(mode: 'sign-in' | 'sign-up'): Promise<void> {
		if (busy) return;
		resetEmailFeedback();
		const normalizedEmail = email.trim().toLowerCase();
		// Existing accounts may still use 6-character passwords, so only new
		// passwords have to meet the stricter minimum.
		if (mode === 'sign-up') {
			if (!isValidEmail(normalizedEmail)) {
				setEmailError('invalid');
				return;
			}
			if (password.length < NEW_PASSWORD_MIN_LENGTH) {
				setEmailError('too-short');
				return;
			}
		}
		if (!isValidEmail(normalizedEmail) || password.length < 6) {
			setEmailError('invalid');
			return;
		}
		const action = mode === 'sign-in' ? 'email-sign-in' : 'email-sign-up';
		setBusy(action);
		try {
			const { signInWithEmailPassword, signUpWithEmailPassword } = await import(
				'@/core/auth/client'
			);
			const result =
				mode === 'sign-in'
					? await signInWithEmailPassword(normalizedEmail, password)
					: await signUpWithEmailPassword(normalizedEmail, password, next);
			if (result.sessionEstablished) {
				onAuthenticated();
			} else {
				setEmailMessage(
					mode === 'sign-up'
						? 'Falls ein neues Konto angelegt wurde, prüfe deine E-Mail und bestätige den Link. Danach kannst du dich anmelden.'
						: 'Die Anmeldung ist noch nicht abgeschlossen. Prüfe deine E-Mail und versuche es erneut.',
				);
			}
		} catch (error) {
			setFailure(classifyAuthError(error));
			setEmailError(mode === 'sign-up' && isWeakPasswordError(error) ? 'weak-password' : 'generic');
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
	const passwordFieldInvalid =
		(emailError === 'invalid' && password.length < 6) ||
		emailError === 'too-short' ||
		emailError === 'weak-password';

	return {
		email,
		setEmail,
		password,
		setPassword,
		newAccountIntent,
		setNewAccountIntent,
		emailError,
		failure,
		emailMessage,
		submitEmail,
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
		newAccountIntent,
		setNewAccountIntent,
		emailError,
		failure,
		emailMessage,
		submitEmail,
		requestPasswordReset,
		emailFieldInvalid,
		passwordFieldInvalid,
	} = auth;
	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void submitEmail('sign-in');
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
						autoComplete={newAccountIntent ? 'new-password' : 'current-password'}
						onFocus={() => setNewAccountIntent(false)}
						enterKeyHint="go"
						minLength={6}
						required
						aria-describedby={
							passwordFieldInvalid ? 'auth-password-hint auth-email-error' : 'auth-password-hint'
						}
						aria-invalid={passwordFieldInvalid || undefined}
						className="text-base"
					/>
					<FieldDescription id="auth-password-hint" className="text-xs">
						Für ein neues Konto mindestens {NEW_PASSWORD_MIN_LENGTH} Zeichen.
					</FieldDescription>
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
				{emailError === 'too-short' && (
					<div id="auth-email-error">
						<ErrorBox>Dein Passwort braucht mindestens {NEW_PASSWORD_MIN_LENGTH} Zeichen.</ErrorBox>
					</div>
				)}
				{emailError === 'weak-password' && (
					<div id="auth-email-error">
						<ErrorBox>{WEAK_PASSWORD_MESSAGE}</ErrorBox>
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
				<div className="flex flex-col gap-2">
					<Button type="submit" variant="default" disabled={busy !== null}>
						{busy === 'email-sign-in' && <Spinner data-icon="inline-start" aria-hidden />}
						Anmelden
					</Button>
					<Button
						type="button"
						variant="outline"
						onPointerDown={() => setNewAccountIntent(true)}
						onFocus={() => setNewAccountIntent(true)}
						onClick={() => void submitEmail('sign-up')}
						disabled={busy !== null}
					>
						{busy === 'email-sign-up' && <Spinner data-icon="inline-start" aria-hidden />}
						Konto erstellen
					</Button>
				</div>
			</FieldGroup>
		</form>
	);
}
