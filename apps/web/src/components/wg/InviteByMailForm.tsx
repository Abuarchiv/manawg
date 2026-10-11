'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch } from '@/core/infra/api-client';
import { Mail } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';

interface Props {
	shareCode: string;
	memberId: string;
}

const ERRORS: Record<string, string> = {
	email_invalid: 'Das sieht nicht wie eine E-Mail-Adresse aus.',
	invite_limit_reached:
		'Es gibt schon 20 aktive Einladungen. Widerrufe eine, bevor du eine neue verschickst.',
	invite_rate_limited: 'Zu viele Einladungen auf einmal. Versuch es in einer Stunde noch mal.',
	mail_unavailable: 'Die Mail konnte nicht verschickt werden. Teile stattdessen den Link.',
};

/** Sends the invitation mail (E6); the address is only used for this one mail. */
export function InviteByMailForm({ shareCode, memberId }: Props) {
	const id = useId();
	const [email, setEmail] = useState('');
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

	async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (pending) return;
		setPending(true);
		setMessage(null);
		const res = await apiFetch<{ status: 'sent' | 'duplicate' }>(
			`/api/wg/${encodeURIComponent(shareCode)}/invitations`,
			{ method: 'POST', memberId, body: JSON.stringify({ email }) },
		);
		setPending(false);
		if (!res.ok) {
			setMessage({
				tone: 'error',
				text: ERRORS[res.error] ?? 'Das hat nicht geklappt. Versuch es noch mal.',
			});
			return;
		}
		setEmail('');
		setMessage({
			tone: 'ok',
			text:
				res.data.status === 'duplicate'
					? 'Diese Adresse hat heute schon eine Einladung bekommen.'
					: 'Einladung ist unterwegs.',
		});
	}

	return (
		<form onSubmit={submit} className="mt-3" noValidate>
			<label
				htmlFor={id}
				className="text-muted-foreground block text-xs font-medium tracking-wider uppercase"
			>
				Per E-Mail einladen
			</label>
			<div className="mt-1 flex gap-2">
				<Input
					id={id}
					type="email"
					inputMode="email"
					autoComplete="off"
					placeholder="name@beispiel.de"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					disabled={pending}
					required
					aria-describedby={message ? `${id}-status` : undefined}
					aria-invalid={message?.tone === 'error' ? true : undefined}
				/>
				<Button
					type="submit"
					variant="outline"
					disabled={pending || email.trim().length === 0}
					aria-label={pending ? 'Einladung wird gesendet…' : 'Einladung senden'}
				>
					{pending ? <Spinner aria-hidden /> : <Mail aria-hidden />}
					Senden
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
				{message?.text ?? 'Die Adresse wird nur für diese eine Mail verwendet.'}
			</p>
		</form>
	);
}
