'use client';

import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { useToast } from '@/components/ui/Toast';
import { createIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { keyUnavailableMessage } from '@/core/offline/offline-copy';
import { formatEuroCents } from '@/core/utils/money';
import { formatRelativeTime, formatTimeFull } from '@/core/utils/time';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payment-input';
import { cashVoidErrorMessage } from './settlement-errors';

const MAX_LISTED = 5;

type CashPayment = ExpensePaymentInput & { id: string };

/** The viewer's own cash payments, newest first; only these can be voided. */
export function ownCashPayments(
	payments: readonly ExpensePaymentInput[],
	currentMemberId: string,
): CashPayment[] {
	return payments
		.filter(
			(payment): payment is CashPayment =>
				Boolean(payment.id) &&
				(payment.fromMemberId === currentMemberId || payment.toMemberId === currentMemberId),
		)
		.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
		.slice(0, MAX_LISTED);
}

interface CashPaymentListProps {
	payments: readonly ExpensePaymentInput[];
	currentMemberId: string;
	shareCode: string;
	memberName: (id: string) => string;
	onSettled: (message?: string) => void;
}

export function CashPaymentList({
	payments,
	currentMemberId,
	shareCode,
	memberName,
	onSettled,
}: CashPaymentListProps) {
	const listed = ownCashPayments(payments, currentMemberId);
	if (listed.length === 0) return null;
	return (
		<section aria-labelledby="cash-payments-heading" className="flex flex-col gap-1">
			<h3 id="cash-payments-heading" className="text-meta font-medium text-muted-foreground">
				Barzahlungen
			</h3>
			<ItemGroup aria-label="Deine Barzahlungen">
				{listed.map((payment) => (
					<CashPaymentRow
						key={payment.id}
						payment={payment}
						currentMemberId={currentMemberId}
						shareCode={shareCode}
						memberName={memberName}
						onSettled={onSettled}
					/>
				))}
			</ItemGroup>
		</section>
	);
}

interface CashPaymentRowProps extends Omit<CashPaymentListProps, 'payments'> {
	payment: CashPayment;
}

function CashPaymentRow({
	payment,
	currentMemberId,
	shareCode,
	memberName,
	onSettled,
}: CashPaymentRowProps) {
	const toast = useToast();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [voiding, setVoiding] = useState(false);
	const voidingRef = useRef(false);
	// A retry after a network error or a server failure reuses the key, so it cannot void twice.
	const keyRef = useRef<string | null>(null);
	const from = payment.fromMemberId === currentMemberId ? 'Du' : memberName(payment.fromMemberId);
	const to = payment.toMemberId === currentMemberId ? 'dich' : memberName(payment.toMemberId);
	const amount = formatEuroCents(payment.amountCents, payment.currency);

	async function voidPayment(): Promise<void> {
		if (voidingRef.current) return;
		keyRef.current ??= createIdempotencyKey();
		if (!keyRef.current) {
			toast.error(keyUnavailableMessage('Die Stornierung', 'gespeichert'));
			return;
		}
		voidingRef.current = true;
		setVoiding(true);
		try {
			const res = await apiFetch<{ amountCents: number }>(
				`/api/wg/${encodeURIComponent(shareCode)}/payments/manual/${encodeURIComponent(payment.id)}`,
				{
					method: 'DELETE',
					memberId: currentMemberId,
					headers: { 'Idempotency-Key': keyRef.current },
				},
			);
			if (!res.ok) {
				if (shouldReleaseIdempotencyKey(res.status, res.error)) keyRef.current = null;
				toast.error(cashVoidErrorMessage(res.error));
				return;
			}
			keyRef.current = null;
			onSettled(
				`Barzahlung storniert: ${amount} von ${memberName(payment.fromMemberId)} an ${memberName(payment.toMemberId)}.`,
			);
		} catch {
			toast.error(cashVoidErrorMessage('Netzwerkfehler'));
		} finally {
			voidingRef.current = false;
			setVoiding(false);
		}
	}

	return (
		<ItemEntry variant="outline" size="sm">
			<ItemContent className="min-w-[min(100%,12rem)]">
				<ItemTitle className="line-clamp-none break-words">
					{from} an {to}
				</ItemTitle>
				<ItemDescription className="line-clamp-none break-words">
					{payment.completedAt ? (
						<time dateTime={payment.completedAt} title={formatTimeFull(payment.completedAt)}>
							{formatRelativeTime(payment.completedAt)}
						</time>
					) : (
						'Bar bezahlt'
					)}
				</ItemDescription>
			</ItemContent>
			<Badge
				variant="outline"
				className="ml-auto h-auto min-h-5 shrink-0 text-meta font-mono tabular-nums"
			>
				{amount}
			</Badge>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={voiding}
				onClick={() => setConfirmOpen(true)}
			>
				Stornieren
			</Button>
			<ConfirmDialog
				open={confirmOpen}
				onClose={() => setConfirmOpen(false)}
				onConfirm={() => void voidPayment()}
				variant="danger"
				title="Barzahlung stornieren?"
				description={`Die Barzahlung über ${amount} von ${memberName(payment.fromMemberId)} an ${memberName(payment.toMemberId)} wird storniert, die Schuld ist danach wieder offen. Stimmt nur der Betrag nicht, trage die Zahlung danach neu ein.`}
				confirmLabel="Stornieren"
			/>
		</ItemEntry>
	);
}
