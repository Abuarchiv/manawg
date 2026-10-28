'use client';

import { isValidEmail, normalizeEmail } from '@/components/auth/auth-form-shared';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { RowNotice, type RowNoticeState } from '@/components/wg/einstellungen/RowNotice';
import { authFailureMessage } from '@/components/wg/einstellungen/settings-errors';
import { classifyAuthError } from '@/core/auth/password-errors';
import { useMessage } from '@/shared/i18n/message';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** E-mail change for password accounts: the new address only takes over once its link is opened. */
export function EmailChangeRow({
	current,
	returnPath,
}: { current: string | null; returnPath: string }) {
	const t = useTranslations('settings');
	const m = useMessage();
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState('');
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<RowNoticeState>(null);

	if (!current) return null;
	const currentEmail = current;

	async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (busy) return;
		const next = normalizeEmail(email);
		if (!isValidEmail(next)) {
			setNotice({ kind: 'error', text: t('emailChange.invalid') });
			return;
		}
		if (next === current) {
			setNotice({ kind: 'error', text: t('emailChange.same') });
			return;
		}
		setBusy(true);
		setNotice(null);
		try {
			const { requestEmailChange } = await import('@/core/auth/client');
			await requestEmailChange(next, returnPath);
			setNotice({
				kind: 'sent',
				text: t('emailChange.sent', { next, current: currentEmail }),
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
						? t('emailChange.exists')
						: m(authFailureMessage(failure, 'settings.emailChange.failed')),
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
						<FieldLabel htmlFor="email-change">{t('emailChange.label')}</FieldLabel>
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
							{t('emailChange.submit')}
						</Button>
						<Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
							{t('actions.cancel')}
						</Button>
					</div>
				</form>
			) : (
				<Button type="button" variant="outline" onClick={() => setOpen(true)}>
					<Mail aria-hidden />
					{t('emailChange.open')}
				</Button>
			)}
			<RowNotice notice={notice} />
		</div>
	);
}
