'use client';

import { ErrorBox } from '@/components/neu/ErrorBox';
import { Loader2 } from 'lucide-react';
import { type ReactElement, useState } from 'react';

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;
const OTP_PATTERN = /^\d{6}$/;

type CredentialsAuthProps = {
	next: string;
	onAuthenticated: () => void;
};

type BusyAction =
	| 'email-sign-in'
	| 'email-sign-up'
	| 'password-reset'
	| 'phone-request'
	| 'phone-verify'
	| null;

function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function GenericAuthError(): ReactElement {
	return (
		<ErrorBox>
			Die Anmeldung konnte gerade nicht abgeschlossen werden. Bitte versuche es erneut.
		</ErrorBox>
	);
}

export function CredentialsAuth({ next, onAuthenticated }: CredentialsAuthProps) {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [phone, setPhone] = useState('');
	const [otp, setOtp] = useState('');
	const [otpRequested, setOtpRequested] = useState(false);
	const [busy, setBusy] = useState<BusyAction>(null);
	const [emailError, setEmailError] = useState<'generic' | 'invalid' | 'reset-invalid' | null>(
		null,
	);
	const [emailMessage, setEmailMessage] = useState<string | null>(null);
	const [phoneError, setPhoneError] = useState<'generic' | 'invalid' | 'unavailable' | null>(null);
	const [phoneMessage, setPhoneMessage] = useState<string | null>(null);

	function resetEmailFeedback(): void {
		setEmailError(null);
		setEmailMessage(null);
	}

	function resetPhoneFeedback(): void {
		setPhoneError(null);
		setPhoneMessage(null);
	}

	async function submitEmail(mode: 'sign-in' | 'sign-up'): Promise<void> {
		if (busy) return;
		resetEmailFeedback();
		const normalizedEmail = email.trim().toLowerCase();
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
		} catch {
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
		} catch {
			setEmailError('generic');
		} finally {
			setBusy(null);
		}
	}

	async function sendPhoneOtp(): Promise<void> {
		if (busy) return;
		resetPhoneFeedback();
		const normalizedPhone = phone.trim();
		if (!E164_PATTERN.test(normalizedPhone)) {
			setPhoneError('invalid');
			return;
		}
		setBusy('phone-request');
		try {
			const { requestPhoneOtp } = await import('@/core/auth/client');
			await requestPhoneOtp(normalizedPhone);
			setPhone(normalizedPhone);
			setOtp('');
			setOtpRequested(true);
			setPhoneMessage('Wenn die Nummer verwendet werden kann, wurde ein SMS-Code gesendet.');
		} catch (error) {
			const { isPhoneAuthUnavailable } = await import('@/core/auth/client');
			setPhoneError(isPhoneAuthUnavailable(error) ? 'unavailable' : 'generic');
		} finally {
			setBusy(null);
		}
	}

	async function confirmPhoneOtp(): Promise<void> {
		if (busy) return;
		resetPhoneFeedback();
		if (!E164_PATTERN.test(phone) || !OTP_PATTERN.test(otp)) {
			setPhoneError('invalid');
			return;
		}
		setBusy('phone-verify');
		try {
			const { verifyPhoneOtp } = await import('@/core/auth/client');
			const result = await verifyPhoneOtp(phone, otp);
			if (result.sessionEstablished) onAuthenticated();
			else setPhoneError('generic');
		} catch {
			setPhoneError('generic');
		} finally {
			setBusy(null);
		}
	}

	function useAnotherPhoneNumber(): void {
		if (busy) return;
		setOtp('');
		setOtpRequested(false);
		resetPhoneFeedback();
	}

	return (
		<div className="space-y-5" aria-busy={busy !== null}>
			<section aria-labelledby="email-auth-heading" className="space-y-3">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void submitEmail('sign-in');
					}}
					className="space-y-3"
				>
					<h2 id="email-auth-heading" className="text-[14px] font-semibold text-[var(--text-1)]">
						Mit E-Mail und Passwort
					</h2>
					<div className="space-y-2">
						<label
							htmlFor="auth-email"
							className="block text-[13px] font-medium text-[var(--text-1)]"
						>
							E-Mail-Adresse
						</label>
						<input
							id="auth-email"
							name="email"
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							autoComplete="email"
							inputMode="email"
							required
							aria-describedby={emailError ? 'auth-email-error' : undefined}
							aria-invalid={emailError ? true : undefined}
							className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						/>
					</div>
					<div className="space-y-2">
						<label
							htmlFor="auth-password"
							className="block text-[13px] font-medium text-[var(--text-1)]"
						>
							Passwort
						</label>
						<input
							id="auth-password"
							name="password"
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							autoComplete="current-password"
							minLength={6}
							required
							aria-describedby={emailError ? 'auth-email-error' : undefined}
							aria-invalid={emailError ? true : undefined}
							className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						/>
					</div>
					<button
						type="button"
						onClick={() => void requestPasswordReset()}
						disabled={busy !== null}
						className="text-left text-[13px] text-[var(--text-2)] underline-offset-4 hover:text-[var(--text-1)] hover:underline disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						{busy === 'password-reset' ? 'Link wird angefordert …' : 'Passwort vergessen?'}
					</button>
					{emailError === 'generic' && (
						<div id="auth-email-error">
							<GenericAuthError />
						</div>
					)}
					{emailError === 'invalid' && (
						<div id="auth-email-error">
							<ErrorBox>
								Bitte gib eine gültige E-Mail-Adresse und ein Passwort mit mindestens 6 Zeichen ein.
							</ErrorBox>
						</div>
					)}
					{emailError === 'reset-invalid' && (
						<div id="auth-email-error">
							<ErrorBox>Bitte gib eine gültige E-Mail-Adresse ein.</ErrorBox>
						</div>
					)}
					{emailMessage && (
						<output className="block text-[13px] text-[var(--text-2)]">{emailMessage}</output>
					)}
					<div className="grid grid-cols-2 gap-2">
						<button
							type="submit"
							disabled={busy !== null}
							className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--text-1)] px-3 text-[13px] font-semibold text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							{busy === 'email-sign-in' && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
							)}
							Anmelden
						</button>
						<button
							type="button"
							onClick={() => void submitEmail('sign-up')}
							disabled={busy !== null}
							className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border-strong)] px-3 text-[13px] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							{busy === 'email-sign-up' && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
							)}
							Konto erstellen
						</button>
					</div>
				</form>
			</section>

			<section
				aria-labelledby="phone-auth-heading"
				className="space-y-3 border-t border-[var(--border)] pt-5"
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void (otpRequested ? confirmPhoneOtp() : sendPhoneOtp());
					}}
					className="space-y-3"
				>
					<h2 id="phone-auth-heading" className="text-[14px] font-semibold text-[var(--text-1)]">
						Mit Telefon per SMS
					</h2>
					<label
						htmlFor="auth-phone"
						className="block text-[13px] font-medium text-[var(--text-1)]"
					>
						Telefonnummer
					</label>
					<input
						id="auth-phone"
						name="phone"
						type="tel"
						value={phone}
						onChange={(event) => setPhone(event.target.value)}
						autoComplete="tel"
						inputMode="tel"
						placeholder="+491701234567"
						aria-describedby={phoneError ? 'auth-phone-hint auth-phone-error' : 'auth-phone-hint'}
						aria-invalid={phoneError ? true : undefined}
						disabled={otpRequested || busy !== null}
						className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					/>
					<p id="auth-phone-hint" className="text-[12px] text-[var(--text-3)]">
						Internationales Format mit + und Landesvorwahl (E.164).
					</p>
					{otpRequested && (
						<div className="space-y-2">
							<label
								htmlFor="auth-phone-otp"
								className="block text-[13px] font-medium text-[var(--text-1)]"
							>
								6-stelliger SMS-Code
							</label>
							<input
								id="auth-phone-otp"
								name="otp"
								type="text"
								value={otp}
								onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
								inputMode="numeric"
								autoComplete="one-time-code"
								maxLength={6}
								pattern="[0-9]{6}"
								aria-describedby={phoneError ? 'auth-phone-error' : undefined}
								aria-invalid={phoneError ? true : undefined}
								className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-center font-mono text-base tracking-[0.3em] text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							/>
						</div>
					)}
					{phoneError === 'generic' && (
						<div id="auth-phone-error">
							<GenericAuthError />
						</div>
					)}
					{phoneError === 'invalid' && (
						<div id="auth-phone-error">
							<ErrorBox>
								Gib eine Telefonnummer im internationalen E.164-Format ein, zum Beispiel
								+491701234567.
							</ErrorBox>
						</div>
					)}
					{phoneError === 'unavailable' && (
						<div id="auth-phone-error">
							<ErrorBox>
								SMS-Anmeldung ist derzeit nicht verfügbar. Bitte nutze E-Mail oder Google.
							</ErrorBox>
						</div>
					)}
					{phoneMessage && (
						<output className="block text-[13px] text-[var(--text-2)]">{phoneMessage}</output>
					)}
					{otpRequested ? (
						<div className="grid gap-2 sm:grid-cols-2">
							<button
								type="submit"
								disabled={busy !== null}
								className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border-strong)] px-3 text-[13px] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								{busy === 'phone-verify' && (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
								)}
								Code bestätigen
							</button>
							<button
								type="button"
								onClick={() => void sendPhoneOtp()}
								disabled={busy !== null}
								className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border)] px-3 text-[13px] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								{busy === 'phone-request' && (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
								)}
								SMS-Code erneut senden
							</button>
							<button
								type="button"
								onClick={useAnotherPhoneNumber}
								disabled={busy !== null}
								className="text-left text-[13px] text-[var(--text-2)] underline-offset-4 hover:text-[var(--text-1)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
							>
								Andere Telefonnummer verwenden
							</button>
						</div>
					) : (
						<button
							type="submit"
							disabled={busy !== null}
							className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-[var(--border-strong)] px-3 text-[13px] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							{busy === 'phone-request' && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
							)}
							SMS-Code anfordern
						</button>
					)}
				</form>
			</section>
		</div>
	);
}
