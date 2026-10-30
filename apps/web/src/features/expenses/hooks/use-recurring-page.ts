import { useCallback, useMemo, useRef, useState } from 'react';
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
import type { RecurringExpense, RecurringFilter } from '@/features/expenses/expense-types';
import {
	recurringActionError,
	recurringDeleteError,
	recurringSaveError,
} from '@/features/expenses/recurring-errors';
import { getDueRecurringExpenses } from '@/features/expenses/recurring-expenses';
import type { RecurringFormValues } from '@/features/expenses/recurring-form-model';
import { useMessage } from '@/shared/i18n/message';
import { haptic } from '@/shared/lib/haptics';

interface RecurringExpensesResponse {
	recurringExpenses: RecurringExpense[];
}

interface RecurringExpenseResponse {
	recurringExpense: RecurringExpense;
}

function sortByNextDue(recurringExpenses: RecurringExpense[]): RecurringExpense[] {
	return [...recurringExpenses].sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
}

function upsertRecurring(current: RecurringExpense[], next: RecurringExpense): RecurringExpense[] {
	const existing = current.some((recurringExpense) => recurringExpense.id === next.id);
	return sortByNextDue(
		existing
			? current.map((recurringExpense) =>
					recurringExpense.id === next.id ? next : recurringExpense,
				)
			: [...current, next],
	);
}

/** Fixkosten page: cached list, 30 s refresh, create/edit/pause/delete with optimistic updates. */
export function useRecurringPage() {
	const { wg, members, identity } = useWg();
	const toast = useToast();
	const t = useMessage();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const collection = useSyncedCollection<RecurringExpensesResponse, RecurringExpense>({
		url: `/api/wg/${encodedShareCode}/recurring-expenses`,
		memberId: identity.memberId,
		select: (data) => sortByNextDue(data.recurringExpenses),
		assemble: (items, current) => ({ ...current, recurringExpenses: items }),
		getId: (recurringExpense) => recurringExpense.id,
		describeError: (error) =>
			t(wgLoadError({ key: 'expenses-recurring.page.loadError.lead' }, error.status, error.error)),
		pollIntervalMs: LIST_REFRESH_INTERVAL_MS,
	});
	const {
		items: recurringExpenses,
		initialLoading: loading,
		refreshing,
		loadError,
		commit: updateRecurring,
	} = collection;
	const memberOptions = useMemo(
		() => members.map((member) => ({ ...member, color: member.color ?? null })),
		[members],
	);

	const [filter, setFilter] = useState<RecurringFilter>('active');
	const [notice, setNotice] = useState<ActionNotice | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	const [editing, setEditing] = useState<RecurringExpense | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [deleteCandidate, setDeleteCandidate] = useState<RecurringExpense | null>(null);
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

	async function handleCreate(values: RecurringFormValues): Promise<void> {
		setSubmitting(true);
		const fingerprint = JSON.stringify(values);
		const idempotencyKey = resolveIdempotencyKey(createRequestRef.current, fingerprint);
		if (!idempotencyKey) {
			setNoticeMessage('error', t({ key: 'expenses-recurring.notice.keyUnavailable' }));
			setSubmitting(false);
			return;
		}
		createRequestRef.current = { fingerprint, key: idempotencyKey };
		const optimisticId = `pending:${idempotencyKey}`;
		const optimisticRecurring: RecurringExpense = {
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
		updateRecurring((current) => upsertRecurring(current, optimisticRecurring));
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
			updateRecurring((current) =>
				upsertRecurring(
					current.filter((recurringExpense) => recurringExpense.id !== optimisticId),
					res.data.recurringExpense,
				),
			);
			setShowCreate(false);
			setNoticeMessage('success', t({ key: 'expenses-recurring.notice.created' }));
		} else {
			updateRecurring((current) =>
				current.filter((recurringExpense) => recurringExpense.id !== optimisticId),
			);
			if (shouldReleaseIdempotencyKey(res.status, res.error)) createRequestRef.current = null;
			const message = t(recurringSaveError(res.error, 'created'));
			setNoticeMessage('error', message);
		}
		setSubmitting(false);
	}

	async function handleEdit(values: RecurringFormValues): Promise<void> {
		if (!editing) return;
		setSubmitting(true);
		const previousRecurring = editing;
		updateRecurring((current) =>
			upsertRecurring(current, {
				...previousRecurring,
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
					expectedNextDueAt: previousRecurring.nextDueAt,
					...(previousRecurring.updatedAt
						? { expectedUpdatedAt: previousRecurring.updatedAt }
						: {}),
				}),
			},
		);
		if (res.ok) {
			haptic('medium');
			updateRecurring((current) => upsertRecurring(current, res.data.recurringExpense));
			setEditing(null);
			setNoticeMessage('success', t({ key: 'expenses-recurring.notice.updated' }));
		} else {
			updateRecurring((current) => upsertRecurring(current, previousRecurring));
			const message = t(recurringSaveError(res.error, 'updated'));
			setNoticeMessage('error', message);
			if (res.status === 409 && res.error === 'recurring_expense_changed') {
				// The form holds the old due date; close it so the next edit starts from fresh data.
				setEditing(null);
				void load(false);
			}
		}
		setSubmitting(false);
	}

	async function handleTogglePause(recurringExpense: RecurringExpense): Promise<void> {
		setPendingId(recurringExpense.id);
		const isPaused = recurringExpense.pausedAt !== null;
		updateRecurring((current) =>
			upsertRecurring(current, {
				...recurringExpense,
				pausedAt: isPaused ? null : new Date().toISOString(),
			}),
		);
		const res = await apiFetch<RecurringExpenseResponse>(
			`/api/wg/${encodedShareCode}/recurring-expenses/${encodeURIComponent(recurringExpense.id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify({ paused: !isPaused }),
			},
		);
		if (res.ok) {
			updateRecurring((current) => upsertRecurring(current, res.data.recurringExpense));
			setNoticeMessage(
				'success',
				t({
					key: isPaused ? 'expenses-recurring.notice.resumed' : 'expenses-recurring.notice.paused',
				}),
			);
		} else {
			updateRecurring((current) => upsertRecurring(current, recurringExpense));
			const message = t(recurringActionError(res.error));
			setNoticeMessage('error', message);
			toast.error(message);
			if (res.status === 409 && res.error === 'recurring_expense_changed') void load(false);
		}
		setPendingId(null);
	}

	async function handleDelete(recurringExpense: RecurringExpense): Promise<void> {
		setPendingId(recurringExpense.id);
		const previousRecurring =
			recurringExpenses.find((item) => item.id === recurringExpense.id) ?? recurringExpense;
		updateRecurring((current) => current.filter((item) => item.id !== recurringExpense.id));
		const res = await apiFetch<{ deleted: true }>(
			`/api/wg/${encodedShareCode}/recurring-expenses/${encodeURIComponent(recurringExpense.id)}`,
			{ method: 'DELETE', memberId: identity.memberId },
		);
		if (res.ok) {
			setNoticeMessage('success', t({ key: 'expenses-recurring.notice.deleted' }));
		} else {
			// Already deleted elsewhere: keep the row gone and show what the server has.
			const alreadyGone = res.status === 404 && res.error === 'recurring_expense_not_found';
			if (alreadyGone) void load(false);
			else updateRecurring((current) => upsertRecurring(current, previousRecurring));
			const message = t(recurringDeleteError(res.error));
			setNoticeMessage('error', message);
			toast.error(message);
		}
		setPendingId(null);
	}

	const activeCount = recurringExpenses.filter(
		(recurringExpense) => recurringExpense.pausedAt === null,
	).length;
	const dueCount = getDueRecurringExpenses(
		recurringExpenses.filter((recurringExpense) => recurringExpense.pausedAt === null),
	).length;
	// Monthly load of active fixed costs: yearly ones count with 1/12.
	const monthly = new Map<string, { totalCents: number; mineCents: number }>();
	for (const recurringExpense of recurringExpenses) {
		if (recurringExpense.pausedAt !== null) continue;
		const months = Math.max(1, recurringExpense.intervalMonths);
		const entry = monthly.get(recurringExpense.currency) ?? { totalCents: 0, mineCents: 0 };
		entry.totalCents += recurringExpense.amountCents / months;
		entry.mineCents +=
			(recurringExpense.splits.find((split) => split.debtorMemberId === identity.memberId)
				?.amountCents ?? 0) / months;
		monthly.set(recurringExpense.currency, entry);
	}

	return {
		identity,
		memberOptions,
		recurringExpenses,
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
