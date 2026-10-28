'use client';

import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { RowNotice, type RowNoticeState } from '@/components/wg/settings/RowNotice';
import { authFailureMessage } from '@/components/wg/settings/settings-errors';
import { classifyAuthError } from '@/core/auth/password-errors';
import { useMessage } from '@/shared/i18n/message';

/** Password change for password accounts: shows the account e-mail and mails a reset link to it. */
export function PasswordChangeRow({ email }: { email: string | null }) {
	const t = useTranslations('settings');
	const m = useMessage();
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<RowNoticeState>(null);

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
				text: t('passwordChange.sent', { email }),
			});
		} catch (error) {
			const failure = classifyAuthError(error);
			setNotice({
				kind: 'error',
				text: m(authFailureMessage(failure, 'settings.passwordChange.failed')),
			});
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
				{t('passwordChange.signedInWith', { email })}
			</p>
			<Button type="button" variant="outline" onClick={() => void send()} disabled={busy}>
				{busy ? <Spinner data-icon="inline-start" aria-hidden /> : <KeyRound aria-hidden />}
				{t('passwordChange.action')}
			</Button>
			<RowNotice notice={notice} />
		</div>
	);
}
