'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch } from '@/core/infra/api-client';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';

interface Props {
	shareCode: string;
	memberId: string;
}

const ERROR_KEYS = {
	email_invalid: 'emailInvalid',
	invite_limit_reached: 'limitReached',
	invite_rate_limited: 'rateLimited',
	mail_unavailable: 'mailUnavailable',
} as const;

/** Sends the invitation mail (E6); the address is only used for this one mail. */
export function InviteByMailForm({ shareCode, memberId }: Props) {
	const t = useTranslations('shell.inviteMail');
	const id = useId();
	const [email, setEmail] = useState('');
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

	async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (pending) return;
		setPending(true);
		setMessage(null);
		const res = await apiFetch<{ status: 'sent' | 'duplicate' | 'unconfirmed' }>(
			`/api/wg/${encodeURIComponent(shareCode)}/invitations`,
			{ method: 'POST', memberId, body: JSON.stringify({ email }) },
		);
		setPending(false);
		if (!res.ok) {
			setMessage({
				tone: 'error',
				text: t(
					Object.hasOwn(ERROR_KEYS, res.error)
						? ERROR_KEYS[res.error as keyof typeof ERROR_KEYS]
						: 'failed',
				),
			});
			return;
		}
		setEmail('');
		setMessage({
			tone: 'ok',
			text:
				res.data.status === 'duplicate'
					? t('duplicate')
					: res.data.status === 'unconfirmed'
						? t('unconfirmed')
						: t('sent'),
		});
	}

	return (
		<form onSubmit={submit} className="mt-3" noValidate>
			<label
				htmlFor={id}
				className="text-muted-foreground block text-xs font-medium tracking-wider uppercase"
			>
				{t('label')}
			</label>
			<div className="mt-1 flex flex-wrap gap-2">
				<Input
					id={id}
					type="email"
					inputMode="email"
					autoComplete="off"
					placeholder={t('placeholder')}
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					disabled={pending}
					required
					aria-describedby={message ? `${id}-status` : undefined}
					aria-invalid={message?.tone === 'error' ? true : undefined}
					className="min-w-0 flex-1 basis-40"
				/>
				<Button
					type="submit"
					variant="outline"
					disabled={pending || email.trim().length === 0}
					aria-label={pending ? t('sending') : t('send')}
				>
					{pending ? <Spinner aria-hidden /> : <Mail aria-hidden />}
					{t('submit')}
				</Button>
			</div>
			<p
				id={`${id}-status`}
				aria-live="polite"
				className={
					message?.tone === 'error'
						? 'text-destructive mt-2 min-h-4 text-xs leading-4'
						: 'text-muted-foreground mt-2 min-h-4 text-xs leading-4'
				}
			>
				{message?.text ?? t('privacy')}
			</p>
		</form>
	);
}
