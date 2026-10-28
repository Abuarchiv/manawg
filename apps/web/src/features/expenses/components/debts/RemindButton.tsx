'use client';

import { Bell, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/Toast';
import { mutationError } from '@/core/http/error-codes';
import { createIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { REMINDER_COOLDOWN_HOURS } from '@/features/expenses/reminders';
import { type Message, useMessage } from '@/shared/i18n/message';

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
	/** For the confirmation: "Reminder sent to Jona". */
	debtorName?: string;
}

const SUBJECT: Message = { key: 'expenses-debts.remind.errors.subject' };

function errorMessage(error: string): Message {
	if (error === 'reminder_cooldown') {
		return {
			key: 'expenses-debts.remind.errors.cooldown',
			values: { hours: REMINDER_COOLDOWN_HOURS },
		};
	}
	if (error === 'reminder_rate_limited') return { key: 'expenses-debts.remind.errors.rateLimited' };
	if (error === 'debtor_opted_out') return { key: 'expenses-debts.remind.errors.optedOut' };
	if (error === 'no_open_debt') return { key: 'expenses-debts.remind.errors.noOpenDebt' };
	if (error === 'not_a_member') return { key: 'expenses-debts.remind.errors.notAMember' };
	return mutationError(
		SUBJECT,
		error,
		{},
		{ key: 'expenses-debts.errors.sentence', values: { subject: SUBJECT } },
	);
}

function successMessage(warning: RemindResponseWarning): Message {
	if (warning === 'notification_delivery_failed')
		return { key: 'expenses-debts.remind.deliveryFailed' };
	if (warning === 'notification_delivery_unknown') {
		return { key: 'expenses-debts.remind.deliveryUnknown' };
	}
	return { key: 'expenses-debts.remind.sentPlain' };
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
	label: idleLabel,
	debtorName,
}: RemindButtonProps) {
	const toast = useToast();
	const t = useTranslations('expenses-debts.remind');
	const message = useMessage();
	const [status, setStatus] = useState<RemindButtonStatus>(
		debtorOptedOut ? 'optedOut' : cooldownActive ? 'cooldown' : 'idle',
	);
	const [feedback, setFeedback] = useState<Message | null>(null);
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
		const idempotencyKey = requestKeyRef.current ?? createIdempotencyKey();
		if (!idempotencyKey) {
			rollbackOptimistic?.();
			const unavailable: Message = { key: 'expenses-debts.remind.keyUnavailable' };
			setStatus('error');
			setFeedback(unavailable);
			toast.error(message(unavailable));
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
						? message(successMessage(res.data.warning))
						: t('sentTo', { name: debtorName }),
				);
				onSent?.(res.data.reminder.id);
				return;
			}
			rollbackOptimistic?.();
			if (shouldReleaseIdempotencyKey(res.status, res.error)) requestKeyRef.current = null;
			if (res.status === 429 && res.error === 'reminder_cooldown') {
				setStatus('cooldown');
				onRejected?.('cooldown');
			} else if (res.status === 403 && res.error === 'debtor_opted_out') {
				setStatus('optedOut');
				onRejected?.('optedOut');
			} else {
				setStatus('error');
			}
			const failure = errorMessage(res.error);
			setFeedback(failure);
			toast.error(message(failure));
		} catch (err) {
			rollbackOptimistic?.();
			const failure = errorMessage(err instanceof Error ? err.message : 'unknown');
			setStatus('error');
			setFeedback(failure);
			toast.error(message(failure));
		} finally {
			sendingRef.current = false;
		}
	}

	let label = idleLabel ?? t('idle');
	if (status === 'sending') label = t('sending');
	else if (status === 'sent') label = t('sent');
	else if (status === 'cooldown') label = cooldownLabel ?? t('cooldown');
	else if (status === 'optedOut') label = t('optedOut');

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
				{status === 'cooldown' && cooldownLabel && (
					<span className="sr-only">{t('cooldownSr')} </span>
				)}
				{label}
			</Button>
			{/* Errors and hints already appear in the toast; inline only on the primary button, never twice in one row. */}
			{primary && feedback && status !== 'sent' && (
				<Alert
					role={status === 'error' ? 'alert' : 'status'}
					variant={status === 'error' ? 'destructive' : 'default'}
				>
					<AlertDescription className="whitespace-normal [overflow-wrap:break-word]">
						{message(feedback)}
					</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
