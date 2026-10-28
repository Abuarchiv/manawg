'use client';

import { Mail } from 'lucide-react';
import { useState } from 'react';
import { isValidEmail, normalizeEmail } from '@/components/auth/auth-form-shared';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { RowNotice, type RowNoticeState } from '@/components/wg/einstellungen/RowNotice';
import { AUTH_FAILURE_MESSAGES, classifyAuthError } from '@/core/auth/password-errors';

/** E-mail change for password accounts: the new address only takes over once its link is opened. */
export function EmailChangeRow({
	current,
	returnPath,
}: {
	current: string | null;
	returnPath: string;
}) {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState('');
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<RowNoticeState>(null);

	if (!current) return null;

	async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (busy) return;
		const next = normalizeEmail(email);
		if (!isValidEmail(next)) {
			setNotice({ kind: 'error', text: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
			return;
		}
		if (next === current) {
			setNotice({ kind: 'error', text: 'Das ist bereits deine E-Mail-Adresse.' });
			return;
		}
		setBusy(true);
		setNotice(null);
		try {
			const { requestEmailChange } = await import('@/core/auth/client');
			await requestEmailChange(next, returnPath);
			setNotice({
				kind: 'sent',
				text: `Wir haben Bestätigungslinks an ${next} und ${current} gesendet. Die Adresse ändert sich, sobald du beide Links geöffnet hast.`,
			});
			setOpen(false);
			setEmail('');
		} catch (error) {
			const failure = classifyAuthError(error);
			const code = error !== null && typeof error === 'object' ? Reflect.get(error, 'code') : '';
			setNotice({
				kind: 'error',
				text:
					code === 'email_exists'
						? 'Diese E-Mail-Adresse wird bereits verwendet.'
						: failure === 'other'
							? 'Die Adresse konnte gerade nicht geändert werden. Bitte versuche es später erneut.'
							: AUTH_FAILURE_MESSAGES[failure],
			});
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex flex-col gap-2">
			{open ? (
				<form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
					<Field>
						<FieldLabel htmlFor="email-change">Neue E-Mail-Adresse</FieldLabel>
						<Input
							id="email-change"
							name="email"
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							readOnly={busy}
							autoComplete="email"
							enterKeyHint="go"
							inputMode="email"
							required
						/>
					</Field>
					<div className="flex gap-2">
						<Button type="submit" disabled={busy}>
							{busy && <Spinner data-icon="inline-start" aria-hidden />}
							Bestätigungslink senden
						</Button>
						<Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
							Abbrechen
						</Button>
					</div>
				</form>
			) : (
				<Button type="button" variant="outline" onClick={() => setOpen(true)}>
					<Mail aria-hidden />
					E-Mail-Adresse ändern
				</Button>
			)}
			<RowNotice notice={notice} />
		</div>
	);
}
