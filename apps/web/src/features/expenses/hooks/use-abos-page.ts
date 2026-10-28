import { useToast } from '@/components/ui/Toast';
import type { ActionNotice, ActionNoticeTone } from '@/components/wg/ActionNoticeBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { wgLoadError } from '@/core/guards/load-errors';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { useSyncedCollection } from '@/core/sync/use-synced-collection';
import { LIST_REFRESH_INTERVAL_MS } from '@/core/utils/use-visibility-paused-interval';
import { aboActionError, aboDeleteError, aboSaveError } from '@/features/expenses/abo-errors';
import type { AboFormValues } from '@/features/expenses/abo-form-model';
import type { Abo, AboFilter } from '@/features/expenses/expense-types';
import { getDueRecurringExpenses } from '@/features/expenses/recurring-expenses';
import { useMessage } from '@/shared/i18n/message';
import { haptic } from '@/shared/lib/haptics';
import { useCallback, useMemo, useRef, useState } from 'react';

interface RecurringExpensesResponse {
	recurringExpenses: Abo[];
}

interface RecurringExpenseResponse {
	recurringExpense: Abo;
}

function sortByNextDue(abos: Abo[]): Abo[] {
	return [...abos].sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
}

function upsertAbo(current: Abo[], next: Abo): Abo[] {
	const existing = current.some((abo) => abo.id === next.id);
	return sortByNextDue(
		existing ? current.map((abo) => (abo.id === next.id ? next : abo)) : [...current, next],
	);
}

/** Fixkosten page: cached list, 30 s refresh, create/edit/pause/delete with optimistic updates. */
export function useAbosPage() {
	const { wg, members, identity } = useWg();
	const toast = useToast();
	const t = useMessage();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const collection = useSyncedCollection<RecurringExpensesResponse, Abo>({
		url: `/api/wg/${encodedShareCode}/recurring-expenses`,
		memberId: identity.memberId,
		select: (data) => sortByNextDue(data.recurringExpenses),
		assemble: (items, current) => ({ ...current, recurringExpenses: items }),
		getId: (abo) => abo.id,
		describeError: (error) =>
			t(wgLoadError({ key: 'expenses-abos.page.loadError.lead' }, error.status, error.error)),
		pollIntervalMs: LIST_REFRESH_INTERVAL_MS,
	});
	const {
		items: abos,
		initialLoading: loading,
		refreshing,
		loadError,
		commit: updateAbos,
	} = collection;
	const memberOptions = useMemo(
		() => members.map((member) => ({ ...member, color: member.color ?? null })),
		[members],
	);

	const [filter, setFilter] = useState<AboFilter>('active');
	const [notice, setNotice] = useState<ActionNotice | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	const [editing, setEditing] = useState<Abo | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [deleteCandidate, setDeleteCandidate] = useState<Abo | null>(null);
	const createRequestRef = useRef<PendingIdempotentRequest | null>(null);

	const loadCollection = collection.load;
	const load = useCallback(
		async (initial: boolean): Promise<void> => {
			await loadCollection({ silent: !initial });
		},
		[loadCollection],
	);

	function setNoticeMessage(tone: ActionNoticeTone, message: string): void {
		// Success as a toast: it dismisses itself, shifts nothing and is visible even far down the list.
		if (tone === 'success') {
			setNotice(null);
			toast.success(message);
			return;
		}
		setNotice({ tone, message });
	}

	async function handleCreate(values: AboFormValues): Promise<void> {
		setSubmitting(true);
		const fingerprint = JSON.stringify(values);
		const idempotencyKey = resolveIdempotencyKey(createRequestRef.current, fingerprint);
		if (!idempotencyKey) {
			setNoticeMessage('error', t({ key: 'expenses-abos.notice.keyUnavailable' }));
			setSubmitting(false);
			return;
		}
		createRequestRef.current = { fingerprint, key: idempotencyKey };
		const optimisticId = `pending:${idempotencyKey}`;
		const optimisticAbo: Abo = {
			id: optimisticId,
			description: values.description,
			category: values.category,
			amountCents: values.amountCents,
			currency: 'EUR',
			paidByMemberId: values.paidByMemberId,
			intervalMonths: values.intervalMonths,
			nextDueAt: values.nextDueAt,
			lastCreatedAt: null,
			pausedAt: null,
			splits: values.splits,
		};
		updateAbos((current) => upsertAbo(current, optimisticAbo));
		const res = await apiFetch<RecurringExpenseResponse>(
			`/api/wg/${encodedShareCode}/recurring-expenses`,
			{
				method: 'POST',
				memberId: identity.memberId,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify(values),
			},
		);
		if (res.ok) {
			createRequestRef.current = null;
			haptic('medium');
			updateAbos((current) =>
				upsertAbo(
					current.filter((abo) => abo.id !== optimisticId),
					res.data.recurringExpense,
				),
			);
			setShowCreate(false);
			setNoticeMessage('success', t({ key: 'expenses-abos.notice.created' }));
		} else {
			updateAbos((current) => current.filter((abo) => abo.id !== optimisticId));
			if (shouldReleaseIdempotencyKey(res.status, res.error)) createRequestRef.current = null;
			const message = t(aboSaveError(res.error, 'created'));
			setNoticeMessage('error', message);
		}
		setSubmitting(false);
	}

	async function handleEdit(values: AboFormValues): Promise<void> {
		if (!editing) return;
		setSubmitting(true);
		const previousAbo = editing;
		updateAbos((current) =>
			upsertAbo(current, {
				...previousAbo,
				...values,
			}),
		);
		const res = await apiFetch<RecurringExpenseResponse>(
			`/api/wg/${encodedShareCode}/recurring-expenses/${encodeURIComponent(editing.id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify({
					...values,
					expectedNextDueAt: previousAbo.nextDueAt,
					...(previousAbo.updatedAt ? { expectedUpdatedAt: previousAbo.updatedAt } : {}),
				}),
			},
		);
		if (res.ok) {
			haptic('medium');
			updateAbos((current) => upsertAbo(current, res.data.recurringExpense));
			setEditing(null);
			setNoticeMessage('success', t({ key: 'expenses-abos.notice.updated' }));
		} else {
			updateAbos((current) => upsertAbo(current, previousAbo));
			const message = t(aboSaveError(res.error, 'updated'));
			setNoticeMessage('error', message);
			if (res.status === 409 && res.error === 'recurring_expense_changed') {
				// The form holds the old due date; close it so the next edit starts from fresh data.
				setEditing(null);
				void load(false);
			}
		}
		setSubmitting(false);
	}

	async function handleTogglePause(abo: Abo): Promise<void> {
		setPendingId(abo.id);
		const isPaused = abo.pausedAt !== null;
		updateAbos((current) =>
			upsertAbo(current, { ...abo, pausedAt: isPaused ? null : new Date().toISOString() }),
		);
		const res = await apiFetch<RecurringExpenseResponse>(
			`/api/wg/${encodedShareCode}/recurring-expenses/${encodeURIComponent(abo.id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify({ paused: !isPaused }),
			},
		);
		if (res.ok) {
			updateAbos((current) => upsertAbo(current, res.data.recurringExpense));
			setNoticeMessage(
				'success',
				t({ key: isPaused ? 'expenses-abos.notice.resumed' : 'expenses-abos.notice.paused' }),
			);
		} else {
			updateAbos((current) => upsertAbo(current, abo));
			const message = t(aboActionError(res.error));
			setNoticeMessage('error', message);
			toast.error(message);
			if (res.status === 409 && res.error === 'recurring_expense_changed') void load(false);
		}
		setPendingId(null);
	}

	async function handleDelete(abo: Abo): Promise<void> {
		setPendingId(abo.id);
		const previousAbo = abos.find((item) => item.id === abo.id) ?? abo;
		updateAbos((current) => current.filter((item) => item.id !== abo.id));
		const res = await apiFetch<{ deleted: true }>(
			`/api/wg/${encodedShareCode}/recurring-expenses/${encodeURIComponent(abo.id)}`,
			{ method: 'DELETE', memberId: identity.memberId },
		);
		if (res.ok) {
			setNoticeMessage('success', t({ key: 'expenses-abos.notice.deleted' }));
		} else {
			// Already deleted elsewhere: keep the row gone and show what the server has.
			const alreadyGone = res.status === 404 && res.error === 'recurring_expense_not_found';
			if (alreadyGone) void load(false);
			else updateAbos((current) => upsertAbo(current, previousAbo));
			const message = t(aboDeleteError(res.error));
			setNoticeMessage('error', message);
			toast.error(message);
		}
		setPendingId(null);
	}

	const activeCount = abos.filter((abo) => abo.pausedAt === null).length;
	const dueCount = getDueRecurringExpenses(abos.filter((abo) => abo.pausedAt === null)).length;
	// Monthly load of active fixed costs: yearly ones count with 1/12.
	const monthly = new Map<string, { totalCents: number; mineCents: number }>();
	for (const abo of abos) {
		if (abo.pausedAt !== null) continue;
		const months = Math.max(1, abo.intervalMonths);
		const entry = monthly.get(abo.currency) ?? { totalCents: 0, mineCents: 0 };
		entry.totalCents += abo.amountCents / months;
		entry.mineCents +=
			(abo.splits.find((split) => split.debtorMemberId === identity.memberId)?.amountCents ?? 0) /
			months;
		monthly.set(abo.currency, entry);
	}

	return {
		identity,
		memberOptions,
		abos,
		filter,
		setFilter,
		loading,
		refreshing,
		loadError,
		load,
		notice,
		setNotice,
		showCreate,
		setShowCreate,
		editing,
		setEditing,
		submitting,
		pendingId,
		deleteCandidate,
		setDeleteCandidate,
		handleCreate,
		handleEdit,
		handleTogglePause,
		handleDelete,
		activeCount,
		dueCount,
		monthly,
	};
}
