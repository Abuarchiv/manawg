'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AUTH_FAILURE_MESSAGES, classifyAuthError } from '@/core/auth/password-errors';
import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';

type Notice = { kind: 'sent' | 'error'; text: string } | null;

/** Password change for password accounts: shows the account e-mail and mails a reset link to it. */
export function PasswordChangeRow() {
	const [email, setEmail] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<Notice>(null);

	useEffect(() => {
		let active = true;
		import('@/core/auth/client')
			.then(({ getEmailAccount }) => getEmailAccount())
			.then((account) => {
				if (active && account?.hasPassword) setEmail(account.email);
			})
			// Without an answer the row stays hidden; sign-in and reset remain available.
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);

	if (!email) return null;

	async function send(): Promise<void> {
		if (busy || !email) return;
		setBusy(true);
		setNotice(null);
		try {
			const { requestPasswordReset } = await import('@/core/auth/client');
			await requestPasswordReset(email);
			setNotice({
				kind: 'sent',
				text: `Wir haben dir einen Link zum Ändern des Passworts an ${email} gesendet.`,
			});
		} catch (error) {
			const failure = classifyAuthError(error);
			setNotice({
				kind: 'error',
				text:
					failure === 'other'
						? 'Der Link konnte gerade nicht gesendet werden. Bitte versuche es später erneut.'
						: AUTH_FAILURE_MESSAGES[failure],
			});
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
				Angemeldet mit E-Mail und Passwort: {email}
			</p>
			<Button type="button" variant="outline" onClick={() => void send()} disabled={busy}>
				{busy ? <Spinner data-icon="inline-start" aria-hidden /> : <KeyRound aria-hidden />}
				Passwort ändern
			</Button>
			{notice && (
				<Alert variant={notice.kind === 'error' ? 'destructive' : 'default'}>
					<AlertDescription>{notice.text}</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
