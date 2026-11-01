'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ErrorBox } from '@/components/app/ErrorBox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
	type AuthFailure,
	classifyAuthError,
	isWeakPasswordError,
	WEAK_PASSWORD_MESSAGE,
} from '@/core/auth/password-errors';
import { type Message, useMessage } from '@/shared/i18n/message';
import { MEMBER_NAME_MAX_LENGTH } from '@/shared/lib/limits';
import {
	type AuthFormProps,
	type BusyAction,
	GenericAuthError,
	isValidEmail,
	NEW_PASSWORD_MIN_LENGTH,
	normalizeEmail,
	useResendCooldown,
} from './auth-form-shared';

/** Seconds before the confirmation mail can be requested again; the server limits stay authoritative. */
const RESEND_COOLDOWN_SECONDS = 60;

type SignUpError =
	| 'name'
	| 'invalid'
	| 'too-short'
	| 'mismatch'
	| 'weak-password'
	| 'generic'
	| null;

/** E-mail registration: validates locally, then waits for the confirmation mail when required. */
export function useEmailSignUp({
	next,
	busy,
	setBusy,
	onAuthenticated,
}: AuthFormProps & { next: string }) {
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirmation, setConfirmation] = useState('');
	const [error, setError] = useState<SignUpError>(null);
	const [failure, setFailure] = useState<AuthFailure>('other');
	// The address the confirmation mail went to; set means the inbox state is shown.
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [cooldown, setCooldown] = useResendCooldown();
	const [resendNotice, setResendNotice] = useState(false);

	function clearFeedback(): void {
		setError(null);
		setFailure('other');
		setResendNotice(false);
	}

	async function submit(): Promise<void> {
		if (busy) return;
		clearFeedback();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) {
			setError('name');
			return;
		}
		const normalizedEmail = normalizeEmail(email);
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
			const result = await signUpWithEmailPassword(normalizedEmail, password, next, trimmedName);
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

	function pickOtherAddress(): void {
		clearFeedback();
		setSentTo(null);
		setCooldown(0);
	}

	return {
		name,
		setName,
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
		pickOtherAddress,
	};
}

function InboxNotice({
	auth,
	busy,
}: {
	auth: ReturnType<typeof useEmailSignUp>;
	busy: BusyAction;
}) {
	const { sentTo, cooldown, resendNotice, error, failure, resend, pickOtherAddress } = auth;
	const t = useTranslations('auth');
	const titleRef = useRef<HTMLDivElement>(null);
	// The form was replaced by this notice, so keyboard and screen reader users land on it.
	useEffect(() => {
		titleRef.current?.focus();
	}, []);
	return (
		<div className="flex flex-col gap-4">
			<Alert>
				<AlertTitle ref={titleRef} tabIndex={-1} className="focus:outline-none">
					{t('signUp.inboxTitle')}
				</AlertTitle>
				<AlertDescription className="[overflow-wrap:anywhere]">
					{t('signUp.inboxBody', { email: sentTo ?? '' })}
				</AlertDescription>
			</Alert>
			{resendNotice && (
				<output className="text-sm text-muted-foreground">{t('signUp.resent')}</output>
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
					{cooldown > 0 ? t('resendIn', { seconds: cooldown }) : t('signUp.resend')}
				</Button>
				<Button type="button" variant="ghost" onClick={pickOtherAddress} disabled={busy !== null}>
					{t('otherEmail')}
				</Button>
			</div>
		</div>
	);
}

const SIGN_UP_FAILED: Message = { key: 'auth.failure.signUp' };

const ERROR_MESSAGES: Record<Exclude<SignUpError, 'generic' | null>, Message> = {
	name: { key: 'auth.signUp.name' },
	invalid: { key: 'auth.validEmail' },
	'too-short': { key: 'auth.signUp.tooShort', values: { min: NEW_PASSWORD_MIN_LENGTH } },
	mismatch: { key: 'auth.mismatch' },
	'weak-password': WEAK_PASSWORD_MESSAGE,
};

export function EmailSignUpForm({
	auth,
	busy,
}: {
	auth: ReturnType<typeof useEmailSignUp>;
	busy: BusyAction;
}) {
	const t = useTranslations('auth');
	const message = useMessage();
	const {
		name,
		setName,
		email,
		setEmail,
		password,
		setPassword,
		confirmation,
		setConfirmation,
		error,
		failure,
	} = auth;
	const formRef = useRef<HTMLFormElement>(null);
	// A failed check leaves focus on the submit button; move it to the field that needs fixing.
	useEffect(() => {
		if (error && error !== 'generic') {
			formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
		}
	}, [error]);
	if (auth.sentTo) return <InboxNotice auth={auth} busy={busy} />;

	const nameInvalid = error === 'name';
	const emailInvalid = error === 'invalid';
	const passwordInvalid = error === 'too-short' || error === 'weak-password';
	const confirmationInvalid = error === 'mismatch';
	const describedBy = (invalid: boolean, hint?: string) =>
		[hint, invalid ? 'signup-error' : undefined].filter(Boolean).join(' ') || undefined;

	return (
		<form
			ref={formRef}
			method="post"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void auth.submit();
			}}
			className="flex flex-col gap-4"
		>
			<FieldGroup>
				<Field data-invalid={nameInvalid}>
					<FieldLabel htmlFor="signup-name">{t('fields.name')}</FieldLabel>
					<Input
						id="signup-name"
						name="name"
						type="text"
						value={name}
						onChange={(event) => setName(event.target.value)}
						readOnly={busy !== null}
						autoComplete="name"
						enterKeyHint="next"
						maxLength={MEMBER_NAME_MAX_LENGTH}
						required
						aria-describedby={describedBy(nameInvalid)}
						aria-invalid={nameInvalid || undefined}
						className="text-base"
					/>
				</Field>
				<Field data-invalid={emailInvalid}>
					<FieldLabel htmlFor="signup-email">{t('fields.email')}</FieldLabel>
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
					<FieldLabel htmlFor="signup-password">{t('fields.password')}</FieldLabel>
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
						{t('signUp.hint', { min: NEW_PASSWORD_MIN_LENGTH })}
					</FieldDescription>
				</Field>
				<Field data-invalid={confirmationInvalid}>
					<FieldLabel htmlFor="signup-password-confirmation">
						{t('fields.passwordRepeat')}
					</FieldLabel>
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
						<ErrorBox>{message(ERROR_MESSAGES[error])}</ErrorBox>
					</div>
				)}
				<Button type="submit" variant="default" disabled={busy !== null}>
					{busy === 'email-sign-up' && <Spinner data-icon="inline-start" aria-hidden />}
					{t('signUp.submit')}
				</Button>
			</FieldGroup>
		</form>
	);
}
