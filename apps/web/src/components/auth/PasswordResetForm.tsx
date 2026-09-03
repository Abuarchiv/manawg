'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type ResetState = 'ready' | 'submitting' | 'unavailable';

interface PasswordResetFormProps {
	recoveryRequested: boolean;
}

export function PasswordResetForm({ recoveryRequested }: PasswordResetFormProps) {
	const router = useRouter();
	const [state, setState] = useState<ResetState>(recoveryRequested ? 'ready' : 'unavailable');
	const [password, setPassword] = useState('');
	const [confirmation, setConfirmation] = useState('');
	const [error, setError] = useState<string | null>(null);

	async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (state !== 'ready' || password.length < 6 || password !== confirmation) {
			setError(
				password.length < 6
					? 'Das Passwort muss mindestens 6 Zeichen lang sein.'
					: 'Die Passwörter stimmen nicht überein.',
			);
			return;
		}
		setError(null);
		setState('submitting');
		try {
			const { updatePassword } = await import('@/core/auth/client');
			await updatePassword(password);
			try {
				await fetch('/api/auth/recovery', { method: 'DELETE', credentials: 'same-origin' });
			} catch {
				// The marker expires quickly; a successful password update must still finish.
			}
			router.replace('/neu');
		} catch {
			setError(
				'Das Passwort konnte gerade nicht geändert werden. Bitte fordere einen neuen Link an.',
			);
			setState('ready');
		}
	}

	if (state === 'unavailable') {
		return (
			<p role="alert" className="text-sm text-[var(--text-2)]">
				Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.
			</p>
		);
	}

	return (
		<form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
			<div className="space-y-2">
				<label
					htmlFor="reset-password"
					className="block text-[13px] font-medium text-[var(--text-1)]"
				>
					Neues Passwort
				</label>
				<input
					id="reset-password"
					name="password"
					type="password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					autoComplete="new-password"
					minLength={6}
					required
					aria-describedby={error ? 'reset-password-error' : undefined}
					aria-invalid={error ? true : undefined}
					className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				/>
			</div>
			<div className="space-y-2">
				<label
					htmlFor="reset-password-confirmation"
					className="block text-[13px] font-medium text-[var(--text-1)]"
				>
					Passwort bestätigen
				</label>
				<input
					id="reset-password-confirmation"
					name="passwordConfirmation"
					type="password"
					value={confirmation}
					onChange={(event) => setConfirmation(event.target.value)}
					autoComplete="new-password"
					minLength={6}
					required
					aria-describedby={error ? 'reset-password-error' : undefined}
					aria-invalid={error ? true : undefined}
					className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				/>
			</div>
			{error && (
				<p id="reset-password-error" role="alert" className="text-sm text-[var(--text-2)]">
					{error}
				</p>
			)}
			<button
				type="submit"
				disabled={state === 'submitting'}
				className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--text-1)] px-3 text-[13px] font-semibold text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			>
				{state === 'submitting' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
				Passwort speichern
			</button>
		</form>
	);
}
