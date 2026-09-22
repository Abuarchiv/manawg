'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch } from '@/core/infra/api-client';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import { Bell, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type RemindButtonStatus = 'idle' | 'sending' | 'sent' | 'error' | 'cooldown' | 'optedOut';
type RemindResponseWarning =
	| null
	| 'notification_delivery_failed'
	| 'notification_delivery_unknown';
type RemindResponse = { reminder: { id: string }; warning: RemindResponseWarning };

interface RemindButtonProps {
	shareCode: string;
	debtorMemberId: string;
	creditorMemberId: string;
	currency: string;
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

function successMessage(warning: RemindResponseWarning): string {
	if (warning === 'notification_delivery_failed') {
		return 'Mahnung gespeichert. Push-Benachrichtigung konnte nicht versendet werden.';
	}
	if (warning === 'notification_delivery_unknown') {
		return 'Mahnung gespeichert. Push-Versand konnte nicht bestätigt werden.';
	}
	return 'Mahnung gesendet.';
}

export function RemindButton({
	shareCode,
	debtorMemberId,
	creditorMemberId,
	currency,
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
	const requestKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (sendingRef.current) return;
		const nextStatus: RemindButtonStatus = debtorOptedOut
			? 'optedOut'
			: cooldownActive
				? 'cooldown'
				: 'idle';
		setStatus((current) => {
			if (current === 'sending' || current === 'sent') return current;
			return nextStatus;
		});
		if (nextStatus === 'idle') setFeedback(null);
	}, [cooldownActive, debtorOptedOut]);

	const disabled =
		status === 'sending' || status === 'cooldown' || status === 'optedOut' || status === 'sent';

	async function handleClick(): Promise<void> {
		if (sendingRef.current || disabled) return;
		sendingRef.current = true;
		setStatus('sending');
		setFeedback(null);
		const idempotencyKey = requestKeyRef.current ?? createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setStatus('error');
			setFeedback(errorMessage('Netzwerkfehler'));
			sendingRef.current = false;
			return;
		}
		requestKeyRef.current = idempotencyKey;
		try {
			const res = await apiFetch<RemindResponse>(
				`/api/wg/${encodeURIComponent(shareCode)}/reminders`,
				{
					method: 'POST',
					memberId: currentMemberId,
					memberToken,
					headers: { 'Idempotency-Key': idempotencyKey },
					body: JSON.stringify({ debtorMemberId, creditorMemberId, currency }),
				},
			);
			if (res.ok) {
				requestKeyRef.current = null;
				setStatus('sent');
				setFeedback(successMessage(res.data.warning));
				onSent?.();
				return;
			}
			if (res.status > 0 && res.status < 500) requestKeyRef.current = null;
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

	let label = 'Mahnen';
	if (status === 'sending') label = 'Sende…';
	else if (status === 'sent') label = 'Gesendet';
	else if (status === 'cooldown') label = cooldownLabel ?? 'Noch gesperrt';
	else if (status === 'optedOut') label = 'Mahnungen deaktiviert';

	return (
		<div className="flex max-w-full flex-col gap-2">
			<Button
				type="button"
				variant={status === 'sent' ? 'secondary' : 'outline'}
				size={size === 'sm' ? 'sm' : 'default'}
				className="h-auto min-h-11 whitespace-normal py-2"
				onClick={() => void handleClick()}
				disabled={disabled}
				aria-label={`Mahnung senden — ${label}`}
			>
				{status === 'sending' ? (
					<Spinner data-icon="inline-start" />
				) : status === 'sent' ? (
					<Check data-icon="inline-start" />
				) : (
					<Bell data-icon="inline-start" />
				)}
				{label}
			</Button>
			{feedback && (
				<Alert
					role={status === 'error' ? 'alert' : 'status'}
					variant={status === 'error' ? 'destructive' : 'default'}
				>
					<AlertDescription>{feedback}</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
