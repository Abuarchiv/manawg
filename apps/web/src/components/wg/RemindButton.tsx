'use client';

import { apiFetch } from '@/core/infra/api-client';
import posthog from '@/shared/lib/analytics';
import { Bell, Check, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

type RemindButtonStatus = 'idle' | 'sending' | 'sent' | 'error' | 'cooldown' | 'optedOut';

interface RemindButtonProps {
	shareCode: string;
	debtorMemberId: string;
	creditorMemberId: string;
	currentMemberId: string;
	memberToken?: string | undefined;
	cooldownActive?: boolean;
	cooldownLabel?: string | null;
	debtorOptedOut?: boolean;
	onSent?: () => void;
	size?: 'sm' | 'md';
}

function errorMessage(error: string): string {
	if (error === 'reminder_cooldown') return 'Bitte etwas warten (48 h pro Person).';
	if (error === 'reminder_rate_limited') return 'Zu viele Mahnungen — bitte später erneut.';
	if (error === 'debtor_opted_out') return 'Diese Person erhält keine Mahnungen.';
	if (error === 'no_open_debt') return 'Keine offene Schuld zwischen euch.';
	if (error === 'not_a_member') return 'Bitte erneut der WG beitreten.';
	if (error === 'Failed to fetch' || error === 'Netzwerkfehler') {
		return 'Mahnung konnte nicht gesendet werden — Verbindung prüfen.';
	}
	return 'Mahnung konnte nicht gesendet werden.';
}

export function RemindButton({
	shareCode,
	debtorMemberId,
	creditorMemberId,
	currentMemberId,
	memberToken,
	cooldownActive,
	cooldownLabel,
	debtorOptedOut,
	onSent,
	size = 'md',
}: RemindButtonProps) {
	const [status, setStatus] = useState<RemindButtonStatus>(
		debtorOptedOut ? 'optedOut' : cooldownActive ? 'cooldown' : 'idle',
	);
	const [feedback, setFeedback] = useState<string | null>(null);
	const sendingRef = useRef(false);

	const disabled =
		status === 'sending' || status === 'cooldown' || status === 'optedOut' || status === 'sent';

	async function handleClick(): Promise<void> {
		if (sendingRef.current || disabled) return;
		sendingRef.current = true;
		setStatus('sending');
		setFeedback(null);
		try {
			const res = await apiFetch<{ reminder: { id: string } }>(
				`/api/wg/${encodeURIComponent(shareCode)}/reminders`,
				{
					method: 'POST',
					memberId: currentMemberId,
					memberToken,
					body: JSON.stringify({ debtorMemberId, creditorMemberId }),
				},
			);
			if (res.ok) {
				posthog.capture('payment_reminder_sent');
				setStatus('sent');
				setFeedback('Mahnung gesendet.');
				onSent?.();
				return;
			}
			if (res.status === 429 && res.error === 'reminder_cooldown') {
				setStatus('cooldown');
			} else if (res.status === 403 && res.error === 'debtor_opted_out') {
				setStatus('optedOut');
			} else {
				setStatus('error');
			}
			setFeedback(errorMessage(res.error));
		} catch (err) {
			setStatus('error');
			setFeedback(err instanceof Error ? errorMessage(err.message) : errorMessage('unknown'));
		} finally {
			sendingRef.current = false;
		}
	}

	const heightClass =
		size === 'sm' ? 'min-h-[44px] h-11 text-[12px]' : 'min-h-[44px] h-11 text-[13px]';

	let label = 'Mahnen';
	if (status === 'sending') label = 'Sende…';
	else if (status === 'sent') label = 'Gesendet';
	else if (status === 'cooldown') label = cooldownLabel ?? 'Cooldown';
	else if (status === 'optedOut') label = 'Aus';

	return (
		<div className="flex flex-col items-end gap-1">
			<button
				type="button"
				onClick={() => void handleClick()}
				disabled={disabled}
				aria-label={`Mahnung senden — ${label}`}
				className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${heightClass} ${
					status === 'sent'
						? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
						: status === 'error'
							? 'border-[var(--danger)]/40 text-[var(--danger)]'
							: 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-1)] hover:border-[var(--border-strong)]'
				}`}
			>
				{status === 'sending' ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
				) : status === 'sent' ? (
					<Check className="h-3.5 w-3.5" aria-hidden />
				) : (
					<Bell className="h-3.5 w-3.5" aria-hidden />
				)}
				{label}
			</button>
			{feedback && (
				<output
					aria-live="polite"
					className={`text-[11px] ${status === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text-3)]'}`}
				>
					{feedback}
				</output>
			)}
		</div>
	);
}
