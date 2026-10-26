'use client';

import { useToast } from '@/components/ui/Toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { mutationErrorMessage } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import { REMINDER_COOLDOWN_HOURS } from '@/features/expenses/reminders';
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
	cooldownActive?: boolean;
	cooldownLabel?: string | null;
	debtorOptedOut?: boolean;
	onSent?: (reminderId: string) => void;
	/** The server rejected the request (429/403): the page reloads or remembers the person so it is not offered again. */
	onRejected?: (kind: 'cooldown' | 'optedOut') => void;
	onOptimistic?: (() => (() => void) | undefined) | undefined;
	size?: 'sm' | 'md';
	primary?: boolean;
	label?: string;
	/** For the confirmation: „Erinnerung an Jona gesendet“. */
	debtorName?: string;
}

function errorMessage(error: string): string {
	if (error === 'reminder_cooldown')
		return `Bitte etwas warten (${REMINDER_COOLDOWN_HOURS} Std. pro Person).`;
	if (error === 'reminder_rate_limited') return 'Zu viele Erinnerungen. Bitte später erneut.';
	if (error === 'debtor_opted_out') return 'Diese Person erhält keine Erinnerungen.';
	if (error === 'no_open_debt') return 'Keine offene Schuld zwischen euch.';
	if (error === 'not_a_member') return 'Tritt der WG bitte erneut bei.';
	return mutationErrorMessage(
		'Erinnerung konnte nicht gesendet werden',
		error,
		{},
		'Erinnerung konnte nicht gesendet werden.',
	);
}

function successMessage(warning: RemindResponseWarning): string {
	if (warning === 'notification_delivery_failed') {
		return 'Erinnerung gespeichert. Push-Benachrichtigung konnte nicht versendet werden.';
	}
	if (warning === 'notification_delivery_unknown') {
		return 'Erinnerung gespeichert. Push-Versand konnte nicht bestätigt werden.';
	}
	return 'Erinnerung gesendet.';
}

export function RemindButton({
	shareCode,
	debtorMemberId,
	creditorMemberId,
	currency,
	currentMemberId,
	cooldownActive,
	cooldownLabel,
	debtorOptedOut,
	onSent,
	onRejected,
	onOptimistic,
	size = 'md',
	primary = false,
	label: idleLabel = 'Erinnern',
	debtorName,
}: RemindButtonProps) {
	const toast = useToast();
	const [status, setStatus] = useState<RemindButtonStatus>(
		debtorOptedOut ? 'optedOut' : cooldownActive ? 'cooldown' : 'idle',
	);
	const [feedback, setFeedback] = useState<string | null>(null);
	const sendingRef = useRef(false);
	const requestKeyRef = useRef<string | null>(null);

	useEffect(() => {
		// A request is genuinely in flight — its own result sets the status.
		if (sendingRef.current) return;
		const nextStatus: RemindButtonStatus = debtorOptedOut
			? 'optedOut'
			: cooldownActive
				? 'cooldown'
				: 'idle';
		setStatus((current) => {
			// 'sent' holds until the reloaded history reports the cooldown; a leftover
			// 'sending' without an in-flight request must not stick — otherwise the
			// button stays on "Sende…" forever with no way to retry.
			if (current === 'sent' && nextStatus !== 'cooldown') return current;
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
		const rollbackOptimistic = onOptimistic?.();
		const idempotencyKey = requestKeyRef.current ?? createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			rollbackOptimistic?.();
			const message = 'Erinnerung konnte nicht sicher gesendet werden. Versuche es erneut.';
			setStatus('error');
			setFeedback(message);
			toast.error(message);
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
					headers: { 'Idempotency-Key': idempotencyKey },
					body: JSON.stringify({ debtorMemberId, creditorMemberId, currency }),
				},
			);
			if (res.ok) {
				requestKeyRef.current = null;
				setStatus('sent');
				// The primary button switches to the next person immediately (remount): only a toast survives that.
				toast.success(
					res.data.warning || !debtorName
						? successMessage(res.data.warning)
						: `Erinnerung an ${debtorName} gesendet.`,
				);
				onSent?.(res.data.reminder.id);
				return;
			}
			rollbackOptimistic?.();
			if (res.status > 0 && res.status < 500) requestKeyRef.current = null;
			if (res.status === 429 && res.error === 'reminder_cooldown') {
				setStatus('cooldown');
				onRejected?.('cooldown');
			} else if (res.status === 403 && res.error === 'debtor_opted_out') {
				setStatus('optedOut');
				onRejected?.('optedOut');
			} else {
				setStatus('error');
			}
			const message = errorMessage(res.error);
			setFeedback(message);
			toast.error(message);
		} catch (err) {
			rollbackOptimistic?.();
			const message = err instanceof Error ? errorMessage(err.message) : errorMessage('unknown');
			setStatus('error');
			setFeedback(message);
			toast.error(message);
		} finally {
			sendingRef.current = false;
		}
	}

	let label = idleLabel;
	if (status === 'sending') label = 'Sendet…';
	else if (status === 'sent') label = 'Gesendet';
	else if (status === 'cooldown') label = cooldownLabel ?? 'Wieder später möglich';
	else if (status === 'optedOut') label = 'Mag keine Erinnerungen';

	return (
		<div
			className={
				primary ? 'flex max-w-full flex-col gap-2' : 'flex max-w-full flex-col items-start gap-2'
			}
		>
			<Button
				type="button"
				variant={status === 'sent' ? 'secondary' : primary ? 'default' : 'outline'}
				size={size === 'sm' ? 'sm' : 'default'}
				className={
					primary ? 'h-auto min-h-11 w-full whitespace-normal py-2' : 'h-auto whitespace-normal'
				}
				onClick={() => void handleClick()}
				disabled={disabled}
			>
				{status === 'sending' ? (
					<Spinner data-icon="inline-start" />
				) : status === 'sent' ? (
					<Check data-icon="inline-start" />
				) : (
					<Bell data-icon="inline-start" />
				)}
				{status === 'cooldown' && cooldownLabel && <span className="sr-only">Wieder möglich </span>}
				{label}
			</Button>
			{/* Errors and hints already appear in the toast; inline only on the primary button, never twice in one row. */}
			{primary && feedback && status !== 'sent' && (
				<Alert
					role={status === 'error' ? 'alert' : 'status'}
					variant={status === 'error' ? 'destructive' : 'default'}
				>
					<AlertDescription className="whitespace-normal [overflow-wrap:break-word]">
						{feedback}
					</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
