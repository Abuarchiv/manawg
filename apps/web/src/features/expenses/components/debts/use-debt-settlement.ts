'use client';

import { useToast } from '@/components/ui/Toast';
import { resolveIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { formatEuroCents, normalizeCurrency } from '@/core/utils/money';
import type { SimplifiedDebt } from '@/features/expenses/debt-reduction';
import { useMessage } from '@/shared/i18n/message';
import { useLocale, useTranslations } from 'next-intl';
import { type MutableRefObject, useRef, useState } from 'react';
import { settlementError } from './settlement-errors';

/** What the server can settle for a debt right now; the confirmation must match it. */
export interface SettlementPreview {
	currency: string;
	netCents: number;
	settleableCents: number;
	remainingCents: number;
	splits: Array<{ id: string; expenseId: string; amountCents: number; offset?: boolean }>;
	reason?: string;
}

interface SettleBatchResponse {
	settled: number;
	settledCents?: number;
	remainingCents?: number;
	reason?: string;
}

type PendingRequest = { fingerprint: string; key: string };

/**
 * The idempotency key for a request body: a retry of the same body reuses its key, anything else
 * gets a fresh one. Null when no key can be created.
 */
function idempotencyKeyFor(ref: MutableRefObject<PendingRequest | null>, body: unknown) {
	const fingerprint = JSON.stringify(body);
	const key = resolveIdempotencyKey(ref.current, fingerprint);
	if (key) ref.current = { fingerprint, key };
	return key;
}

interface DebtSettlementInput {
	debt: SimplifiedDebt;
	shareCode: string;
	currentMemberId: string;
	onSettled: (message?: string) => void;
}

/**
 * Manual settlement of one debt: review what can be settled, then confirm a payment that
 * already happened. A retry of the same confirmation reuses its idempotency key.
 */
export function useDebtSettlement({
	debt,
	shareCode,
	currentMemberId,
	onSettled,
}: DebtSettlementInput) {
	// Settle errors stay visible inline (dialog or row, role=alert); only the review has no inline spot.
	const toast = useToast();
	const locale = useLocale();
	const t = useTranslations('expenses-debts.settle');
	const message = useMessage();
	const money = (cents: number) => formatEuroCents(cents, debt.currency, { locale });
	const [reviewOpen, setReviewOpen] = useState(false);
	const [settling, setSettling] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const [preview, setPreview] = useState<SettlementPreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const settlingRef = useRef(false);
	const settlementRequestRef = useRef<PendingRequest | null>(null);
	const cashRequestRef = useRef<PendingRequest | null>(null);
	const endpoint = `/api/wg/${encodeURIComponent(shareCode)}/expenses/settle-batch`;
	const cashEndpoint = `/api/wg/${encodeURIComponent(shareCode)}/payments/manual`;

	async function review(): Promise<void> {
		if (settlingRef.current) return;
		settlingRef.current = true;
		setReviewing(true);
		setError(null);
		try {
			// apiFetch reports failures in its result and never throws.
			const res = await apiFetch<SettlementPreview>(
				`${endpoint}?${new URLSearchParams({ fromMemberId: debt.fromId, toMemberId: debt.toId, currency: normalizeCurrency(debt.currency) })}`,
				{ memberId: currentMemberId },
			);
			if (res.ok) {
				setPreview(res.data);
				setReviewOpen(true);
			} else {
				toast.error(t('checkFailed'));
			}
		} finally {
			settlingRef.current = false;
			setReviewing(false);
		}
	}

	async function settle(): Promise<void> {
		if (settlingRef.current || !preview || preview.settleableCents <= 0) return;
		settlingRef.current = true;
		setSettling(true);
		setError(null);
		const body = {
			fromMemberId: debt.fromId,
			toMemberId: debt.toId,
			currency: normalizeCurrency(debt.currency),
			expected: {
				currency: preview.currency,
				netCents: preview.netCents,
				settleableCents: preview.settleableCents,
				splits: preview.splits.map(({ id, amountCents, offset }) => ({
					id,
					amountCents,
					offset: offset === true,
				})),
			},
		};
		const idempotencyKey = idempotencyKeyFor(settlementRequestRef, body);
		if (!idempotencyKey) {
			setError(t('keyUnavailable'));
			settlingRef.current = false;
			setSettling(false);
			return;
		}
		try {
			const res = await apiFetch<SettleBatchResponse>(endpoint, {
				method: 'POST',
				memberId: currentMemberId,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				if (shouldReleaseIdempotencyKey(res.status, res.error)) settlementRequestRef.current = null;
				setError(message(settlementError(res.error)));
				if (res.error === 'settlement_changed') {
					setPreview(null);
					setReviewOpen(false);
				}
				return;
			}
			settlementRequestRef.current = null;
			const { settled, settledCents, remainingCents, reason } = res.data;
			setPreview(null);
			setReviewOpen(false);
			const names = { from: debt.fromName, to: debt.toName };
			if (reason === 'no_direct_splits') onSettled(t('noDirectSplits'));
			else if (settled > 0 && remainingCents) {
				onSettled(
					t('recordedWithRemaining', {
						amount: money(settledCents ?? 0),
						remaining: money(remainingCents),
						...names,
					}),
				);
			} else if (settled > 0)
				onSettled(t('recorded', { amount: money(settledCents ?? 0), ...names }));
			else onSettled(t('nothingRecorded'));
		} finally {
			settlingRef.current = false;
			setSettling(false);
		}
	}

	/** Enter the whole net debt as a cash payment, for debts no single share can express. */
	async function settleCash(): Promise<void> {
		if (settlingRef.current || !preview || preview.netCents <= 0) return;
		settlingRef.current = true;
		setSettling(true);
		setError(null);
		const body = {
			fromMemberId: debt.fromId,
			toMemberId: debt.toId,
			currency: normalizeCurrency(debt.currency),
			expectedNetCents: preview.netCents,
		};
		const idempotencyKey = idempotencyKeyFor(cashRequestRef, body);
		if (!idempotencyKey) {
			setError(t('cashKeyUnavailable'));
			settlingRef.current = false;
			setSettling(false);
			return;
		}
		try {
			const res = await apiFetch<{ amountCents: number }>(cashEndpoint, {
				method: 'POST',
				memberId: currentMemberId,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				if (shouldReleaseIdempotencyKey(res.status, res.error)) cashRequestRef.current = null;
				setError(message(settlementError(res.error)));
				if (res.error === 'settlement_changed') {
					setPreview(null);
					setReviewOpen(false);
				}
				return;
			}
			cashRequestRef.current = null;
			setPreview(null);
			setReviewOpen(false);
			onSettled(
				t('cashRecorded', {
					amount: money(res.data.amountCents),
					from: debt.fromName,
					to: debt.toName,
				}),
			);
		} finally {
			settlingRef.current = false;
			setSettling(false);
		}
	}

	/** Closing the dialog also clears a failed attempt's error so it does not stick to the row. */
	function setReviewDialogOpen(open: boolean): void {
		if (settling) return;
		setReviewOpen(open);
		if (!open) setError(null);
	}

	return {
		reviewOpen,
		setReviewOpen,
		setReviewDialogOpen,
		settling,
		reviewing,
		preview,
		error,
		review,
		settle,
		settleCash,
	};
}

export type DebtSettlement = ReturnType<typeof useDebtSettlement>;
