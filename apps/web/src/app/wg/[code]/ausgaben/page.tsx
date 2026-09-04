'use client';

import { EmptyState } from '@/components/ui/EmptyState';
import { ALERT_DANGER_ROW, EMPTY_PLACEHOLDER, LIST_CARD } from '@/components/ui/styles';
import { type ActionNotice, ActionNoticeBanner } from '@/components/wg/ActionNoticeBanner';
import { DebtSummary } from '@/components/wg/DebtSummary';
import { OfflineQueueNotice } from '@/components/wg/OfflineQueueNotice';
import { SubNav } from '@/components/wg/SubNav';
import { useWg } from '@/components/wg/WgContextProvider';
import { BalanceBars } from '@/components/wg/dashboard/BalanceBars';
import { Panel } from '@/components/wg/dashboard/Panel';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { usePendingSet } from '@/core/hooks/usePendingSet';
import { apiFetch } from '@/core/infra/api-client';
import { captureException } from '@/core/infra/observability';
import { removeDraft } from '@/core/offline/drafts';
import {
	enqueueOfflineAction,
	readOfflineQueue,
	syncOfflineActions,
	writeOfflineQueue,
} from '@/core/offline/offline-client';
import {
	DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE,
} from '@/core/offline/offline-copy';
import {
	type OfflineActionType,
	createQueuedExpense,
	createQueuedRecurring,
} from '@/core/offline/offline-queue';
import { useOfflineQueueSync } from '@/core/offline/useOfflineQueueSync';
import { parseEuroAmount } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { parseTimestamp } from '@/core/utils/time';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { AusgabenHeader } from '@/features/expenses/components/ausgaben/AusgabenHeader';
import { ExpenseRow } from '@/features/expenses/components/ausgaben/ExpenseRow';
import { ExpensesSkeleton } from '@/features/expenses/components/ausgaben/ExpensesSkeleton';
import { RecurringExpensesSection } from '@/features/expenses/components/ausgaben/RecurringExpensesSection';
import {
	AMOUNT_MAX_EUROS,
	AMOUNT_MIN_EUROS,
	DESCRIPTION_MAX,
	QUICK_EXPENSE_TEMPLATES,
} from '@/features/expenses/components/ausgaben/constants';
import type {
	Expense,
	ExpenseSplit,
	RecurringExpense,
} from '@/features/expenses/components/ausgaben/expense-types';
import { useExpenseForm } from '@/features/expenses/components/ausgaben/useExpenseForm';
import {
	buildSettlementSummary,
	computeDirectDebts,
	computeNetBalances,
} from '@/features/expenses/debt-reduction';
import {
	expenseActionErrorMessage,
	expenseSaveErrorMessage,
	recurringAdvanceWarningMessage,
	recurringTemplateDeleteErrorMessage,
	recurringTemplateSaveErrorMessage,
	splitInputErrorMessage,
} from '@/features/expenses/expense-errors';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payments';
import {
	type SplitInputResult,
	buildSplitsFromForm,
	payerOptions,
	splitCandidates,
} from '@/features/expenses/expense-split-input';
import { addMonths } from '@/features/expenses/recurring-expenses';
import { haptic } from '@/shared/lib/haptics';
import { Bell, ChevronDown, Loader2, Receipt, RefreshCw, RotateCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const ExpenseFormSection = dynamic(
	() =>
		import('@/features/expenses/components/ausgaben/ExpenseFormSection').then(
			(module) => module.ExpenseFormSection,
		),
	{
		loading: () => (
			<output className="block text-sm text-[var(--text-2)]">Ausgabenformular wird geladen…</output>
		),
	},
);

// ── Helpers ────────────────────────────────────────────────────────────────────

function removeRecurringTemplate(items: RecurringExpense[], id: string): RecurringExpense[] {
	return items.filter((item) => item.id !== id);
}

// ── Page ───────────────────────────────────────────────────────────────────────

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function AusgabenPage() {
	const { wg, members, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const searchParams = useSearchParams();
	const highlightedId = searchParams.get('highlight');
	const prefillDescription = searchParams.get('desc');
	const prefillAmount = searchParams.get('amount');
	const prefillPaidBy = searchParams.get('paidBy');
	const recurringId = searchParams.get('recurring');
	const recurringFilterActive = searchParams.get('filter') === 'recurring';

	const [expenses, setExpenses] = useState<Expense[]>([]);
	const [payments, setPayments] = useState<ExpensePaymentInput[]>([]);
	const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
	const [initialLoading, setInitialLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const { isPending, start: startPending, end: endPending } = usePendingSet();

	// Everything the form itself edits, plus its localStorage draft.
	const {
		showForm,
		setShowForm,
		description,
		setDescription,
		amountStr,
		setAmountStr,
		imageUrl,
		setImageUrl,
		paidByMemberId,
		setPaidByMemberId,
		splitMode,
		setSplitMode,
		manualSplits,
		setManualSplits,
		formError,
		setFormError,
		conflictExpenseId,
		setConflictExpenseId,
		editingExpense,
		invalidEditDraft,
		editingRecurringExpense,
		setEditingRecurringExpense,
		queueEditId,
		setQueueEditId,
		queueEditType,
		setQueueEditType,
		recurringIntervalMonths,
		setRecurringIntervalMonths,
		recurringNextDueAt,
		setRecurringNextDueAt,
		draftKey,
		pendingPrefill,
		recurringSourceId,
		acceptPendingPrefill,
		resetForm,
		applyQuickExpense,
		startEdit,
		startRecurringEdit,
	} = useExpenseForm({
		shareCode: wg.shareCode,
		members,
		identityMemberId: identity.memberId,
		prefillDescription,
		prefillAmount,
		prefillPaidBy,
		recurringId,
		recurringExpenses,
	});

	const [creatingRecurringId, setCreatingRecurringId] = useState<string | null>(null);
	const [savingRecurringTemplate, setSavingRecurringTemplate] = useState(false);
	const submittingRef = useRef(false);
	const savingRecurringTemplateRef = useRef(false);
	const creatingRecurringRef = useRef(false);
	const loadRequestIdRef = useRef(0);
	const initialLoadStartedRef = useRef(false);
	const mountedRef = useRef(false);

	function setActionError(message: string | null): void {
		setActionNotice(message ? { message, tone: 'error' } : null);
	}

	function setActionWarning(message: string): void {
		setActionNotice({ message, tone: 'warning' });
	}

	// Always awaited: a fire-and-forget version of this once existed alongside
	// this awaited one and could drop advance failures silently if the tab
	// closed right after submit, while this path always surfaced a warning.
	async function advanceRecurringTemplate(
		templateId: string,
		expectedNextDueAt: string | undefined,
	): Promise<boolean> {
		const advanceRes = await apiFetch<{ recurringExpense: RecurringExpense }>(
			`/api/wg/${encodedShareCode}/recurring-expenses`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({
					id: templateId,
					...(expectedNextDueAt ? { expectedNextDueAt } : {}),
				}),
			},
		);
		if (advanceRes.ok) {
			setRecurringExpenses((current) =>
				current.map((item) =>
					item.id === advanceRes.data.recurringExpense.id ? advanceRes.data.recurringExpense : item,
				),
			);
			return true;
		}
		setActionWarning(recurringAdvanceWarningMessage(advanceRes.status, advanceRes.error));
		return false;
	}

	function setActionSuccess(message: string): void {
		setActionNotice({ message, tone: 'success' });
	}

	function toggleExpand(id: string): void {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	const load = useCallback(
		async (isInitial: boolean): Promise<void> => {
			const requestId = loadRequestIdRef.current + 1;
			loadRequestIdRef.current = requestId;
			if (isInitial) setInitialLoading(true);
			else setRefreshing(true);

			const res = await apiFetch<{
				expenses: Expense[];
				payments?: ExpensePaymentInput[];
			}>(`/api/wg/${encodedShareCode}/expenses`, { memberId: identity.memberId });
			const recurringRes = await apiFetch<{ recurringExpenses: RecurringExpense[] }>(
				`/api/wg/${encodedShareCode}/recurring-expenses`,
				{ memberId: identity.memberId },
			);
			if (requestId !== loadRequestIdRef.current) {
				if (isInitial) setInitialLoading(false);
				else setRefreshing(false);
				return;
			}
			if (!mountedRef.current) return;

			let nextLoadError: string | null = null;

			if (res.ok) {
				setExpenses(res.data.expenses);
				setPayments(res.data.payments ?? []);
				syncOfflineActions(wg.shareCode, { memberId: identity.memberId })
					.then((synced) => {
						if (!mountedRef.current) return;
						if (requestId !== loadRequestIdRef.current) return;
						refreshCount();
						if (synced > 0) void load(false);
					})
					.catch((err) =>
						captureException(err, { action: 'syncOfflineActions', page: 'ausgaben' }),
					);
			} else {
				nextLoadError = getWgLoadErrorMessage('Ausgaben', res.status, res.error, {
					verb: 'konnten',
				});
			}
			if (recurringRes.ok) setRecurringExpenses(recurringRes.data.recurringExpenses);
			else if (!nextLoadError) {
				nextLoadError = getWgLoadErrorMessage(
					'Fixkosten',
					recurringRes.status,
					recurringRes.error,
					{
						verb: 'konnten',
					},
				);
			}
			setLoadError(nextLoadError);

			if (isInitial) setInitialLoading(false);
			else setRefreshing(false);
		},
		[encodedShareCode, identity.memberId, wg.shareCode],
	);
	const expenseCount = expenses.length;

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (initialLoadStartedRef.current) return;
		initialLoadStartedRef.current = true;
		void load(true);
	}, [load]);
	// Auto-Refresh wie auf dem Dashboard — ersetzt den manuellen Reload-Button.
	useVisibilityPausedInterval(() => void load(false), 30_000);

	function clearEditedQueueItem(expectedTypes?: OfflineActionType[]): boolean {
		if (!queueEditId) return true;
		if (expectedTypes) {
			const queued = readOfflineQueue().find((item) => item.id === queueEditId);
			if (!queued || !expectedTypes.includes(queued.type)) return true;
		}
		const saved = writeOfflineQueue(readOfflineQueue().filter((item) => item.id !== queueEditId));
		if (!saved) return false;
		setQueueEditId(null);
		setQueueEditType(null);
		setRecurringNextDueAt(null);
		return true;
	}

	const { queuedCount, refreshCount } = useOfflineQueueSync({
		shareCode: wg.shareCode,
		memberId: identity.memberId,
		page: 'ausgaben',
		onSynced: () => void load(false),
	});

	useEffect(() => {
		if (!highlightedId || expenseCount === 0) return;
		const timerId = window.setTimeout(() => {
			document.getElementById(`expense-${highlightedId}`)?.scrollIntoView({
				block: 'center',
				behavior: 'smooth',
			});
		}, 80);
		return () => window.clearTimeout(timerId);
	}, [highlightedId, expenseCount]);

	useEffect(() => {
		if (!recurringFilterActive && !recurringId) return;
		const timerId = window.setTimeout(() => {
			document.getElementById('recurring-expenses')?.scrollIntoView({
				block: 'start',
				behavior: 'smooth',
			});
		}, 80);
		return () => window.clearTimeout(timerId);
	}, [recurringFilterActive, recurringId]);

	function memberName(id: string): string {
		return members.find((m) => m.id === id)?.name ?? '?';
	}

	function memberColor(id: string): string | null {
		return members.find((m) => m.id === id)?.color ?? null;
	}

	function memberPayPalMerchantId(id: string): string | null {
		return members.find((m) => m.id === id)?.paypalMerchantId ?? null;
	}

	// A member who moved out ("Auszug") drops out of every picker, while the
	// full `members` list stays in use for name/colour/balance lookups so the
	// history keeps resolving. See expense-split-input.ts for the cases where a
	// moved-out member has to be offered anyway.
	const selectablePayers = payerOptions(members, paidByMemberId);
	const selectableSplitMembers = splitCandidates(members, splitMode, manualSplits);

	function buildSplits(amountCents: number): SplitInputResult {
		return buildSplitsFromForm({
			splitMode,
			members,
			manualSplits,
			amountCents,
			// Cycles the "+1 cent" recipient across expenses so the same person
			// doesn't always eat the leftover cent on uneven splits.
			rotationOffset: expenses.length,
		});
	}

	async function submit(): Promise<void> {
		if (invalidEditDraft) {
			setFormError(
				'Die Zuordnung dieses Entwurfs ist beschädigt. Öffne die ursprüngliche Ausgabe erneut oder verwirf den Entwurf.',
			);
			return;
		}
		setFormError(null);
		setConflictExpenseId(null);
		const desc = description.trim();
		if (desc.length === 0 || desc.length > DESCRIPTION_MAX) {
			setFormError('Beschreibung fehlt.');
			return;
		}
		const amountEuros = parseEuroAmount(amountStr);
		if (amountEuros === null || amountEuros < AMOUNT_MIN_EUROS || amountEuros > AMOUNT_MAX_EUROS) {
			setFormError('Betrag ungültig.');
			return;
		}
		const amountCents = Math.round(amountEuros * CENTS_PER_EURO);
		const splitResult = buildSplits(amountCents);
		if (!splitResult.ok) {
			setFormError(splitInputErrorMessage(splitResult.reason));
			return;
		}
		const splits = splitResult.splits;

		if (submittingRef.current) return;
		submittingRef.current = true;
		const finishSubmitting = () => {
			submittingRef.current = false;
			setSubmitting(false);
		};
		setSubmitting(true);

		const isEdit = editingExpense !== null;
		const url = isEdit
			? `/api/wg/${encodedShareCode}/expenses/${encodeURIComponent(editingExpense.id)}`
			: `/api/wg/${encodedShareCode}/expenses`;
		const res = await apiFetch<Expense | { expense: Expense }>(url, {
			method: isEdit ? 'PATCH' : 'POST',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify({
				paidByMemberId,
				amountCents,
				description: desc,
				imageUrl,
				splits,
				expectedUpdatedAt: editingExpense?.updatedAt,
			}),
		});

		if (!res.ok) {
			if (res.status === 0) {
				const recurringTemplateForQueuedExpense = recurringSourceId
					? recurringExpenses.find((item) => item.id === recurringSourceId)
					: null;
				const queuedCount = enqueueOfflineAction(
					createQueuedExpense({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						description: desc,
						amountCents,
						paidByMemberId,
						splits,
						imageUrl,
						...(recurringTemplateForQueuedExpense
							? {
									recurringExpenseId: recurringTemplateForQueuedExpense.id,
									expectedRecurringNextDueAt: recurringTemplateForQueuedExpense.nextDueAt,
								}
							: {}),
					}),
				);
				if (queuedCount === 0) {
					finishSubmitting();
					setActionError(OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE);
					return;
				}
				refreshCount();
				if (!clearEditedQueueItem(['expense.create'])) {
					finishSubmitting();
					setActionError(OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE);
					return;
				}
				resetForm();
				setShowForm(false);
				finishSubmitting();
				removeDraft(draftKey);
				setActionWarning(
					'Offline gespeichert. Wird synchronisiert, sobald ihr wieder online seid.',
				);
				return;
			}
			if (isEdit && res.status === 404 && res.error === 'expense_not_found') {
				setFormError(
					'Die ursprüngliche Ausgabe wurde gelöscht. Deine ungespeicherten Änderungen bleiben im Entwurf; du kannst sie kopieren oder den Entwurf verwerfen.',
				);
				setExpenses((current) => current.filter((expense) => expense.id !== editingExpense.id));
				setActionError('Diese Ausgabe existiert nicht mehr und wurde aus der Liste entfernt.');
				void load(false);
				finishSubmitting();
				return;
			}
			const msg =
				res.status === 409
					? 'Diese Ausgabe wurde inzwischen geändert. Lade die Liste neu und entscheide dann, welche Version stimmt.'
					: expenseSaveErrorMessage(res.error);
			if (res.status === 409) setConflictExpenseId(editingExpense?.id ?? null);
			setFormError(msg);
			finishSubmitting();
			return;
		}

		if (!clearEditedQueueItem(['expense.create'])) {
			finishSubmitting();
			setActionError(DRAFT_CLEANUP_FAILED_MESSAGE);
			return;
		}
		resetForm();
		const savedExpense = 'expense' in res.data ? res.data.expense : res.data;
		setActionSuccess(
			isEdit
				? 'Ausgabe aktualisiert. Hier wird kein Geld überwiesen.'
				: 'Ausgabe gespeichert. Hier wird kein Geld überwiesen.',
		);
		setExpenses((current) =>
			isEdit
				? current.map((expense) => (expense.id === savedExpense.id ? savedExpense : expense))
				: [savedExpense, ...current.filter((expense) => expense.id !== savedExpense.id)],
		);
		if (recurringSourceId) {
			const recurringTemplateForAdvance = recurringExpenses.find(
				(item) => item.id === recurringSourceId,
			);
			await advanceRecurringTemplate(recurringSourceId, recurringTemplateForAdvance?.nextDueAt);
		}
		setShowForm(false);
		finishSubmitting();
		removeDraft(draftKey);
		void load(false);
	}

	async function saveRecurringTemplate(): Promise<void> {
		if (savingRecurringTemplateRef.current) return;
		setFormError(null);
		const wasEditingQueuedRecurring = queueEditType === 'recurring.create';
		const desc = description.trim();
		const amountEuros = parseEuroAmount(amountStr);
		if (!desc || amountEuros === null || amountEuros <= 0) {
			setFormError('Beschreibung und Betrag fehlen.');
			return;
		}
		const amountCents = Math.round(amountEuros * CENTS_PER_EURO);
		const splitResult = buildSplits(amountCents);
		if (!splitResult.ok) {
			setFormError('Aufteilung zuerst sauber ausfüllen.');
			return;
		}
		const splits = splitResult.splits;
		const queuedNextDueAt =
			wasEditingQueuedRecurring && recurringNextDueAt ? parseTimestamp(recurringNextDueAt) : null;
		const nextDueAt =
			!editingRecurringExpense && queuedNextDueAt === null
				? addMonths(new Date(), recurringIntervalMonths)
				: new Date(editingRecurringExpense?.nextDueAt ?? queuedNextDueAt ?? Date.now());
		savingRecurringTemplateRef.current = true;
		const finishSavingRecurringTemplate = () => {
			savingRecurringTemplateRef.current = false;
			setSavingRecurringTemplate(false);
		};
		setSavingRecurringTemplate(true);
		const res = await apiFetch<{ recurringExpense: RecurringExpense }>(
			`/api/wg/${encodedShareCode}/recurring-expenses`,
			{
				method: editingRecurringExpense ? 'PATCH' : 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({
					id: editingRecurringExpense?.id,
					description: desc,
					amountCents,
					paidByMemberId,
					intervalMonths: recurringIntervalMonths,
					nextDueAt: nextDueAt.toISOString(),
					splits,
				}),
			},
		);
		if (!res.ok) {
			if (res.status === 0 && !editingRecurringExpense) {
				const queued = createQueuedRecurring({
					wgId: wg.id,
					shareCode: wg.shareCode,
					memberId: identity.memberId,
					description: desc,
					amountCents,
					paidByMemberId,
					intervalMonths: recurringIntervalMonths,
					nextDueAt: nextDueAt.toISOString(),
					splits,
				});
				if (enqueueOfflineAction(queued) === 0) {
					setActionError(OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE);
					finishSavingRecurringTemplate();
					return;
				}
				refreshCount();
				setRecurringExpenses((current) => [
					...current,
					{
						id: queued.id,
						description: desc,
						amountCents,
						paidByMemberId,
						intervalMonths: recurringIntervalMonths,
						nextDueAt: nextDueAt.toISOString(),
						lastCreatedAt: null,
						splits,
					},
				]);
				if (!clearEditedQueueItem(['recurring.create'])) {
					setActionError(OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE);
					finishSavingRecurringTemplate();
					return;
				}
				if (wasEditingQueuedRecurring) {
					resetForm();
					setShowForm(false);
					removeDraft(draftKey);
				}
				setActionWarning('Fixkosten-Vorlage offline gespeichert.');
				finishSavingRecurringTemplate();
				return;
			}
			if (
				editingRecurringExpense &&
				res.status === 404 &&
				res.error === 'recurring_expense_not_found'
			) {
				const staleId = editingRecurringExpense.id;
				resetForm();
				setShowForm(false);
				setRecurringExpenses((current) => current.filter((item) => item.id !== staleId));
				setActionError(
					'Diese Fixkosten-Vorlage existiert nicht mehr und wurde aus der Liste entfernt.',
				);
				void load(false);
				finishSavingRecurringTemplate();
				return;
			}
			setFormError(recurringTemplateSaveErrorMessage(res.error));
			finishSavingRecurringTemplate();
			return;
		}
		setRecurringExpenses((current) =>
			editingRecurringExpense
				? current.map((item) =>
						item.id === res.data.recurringExpense.id ? res.data.recurringExpense : item,
					)
				: [...current, res.data.recurringExpense],
		);
		setEditingRecurringExpense(null);
		if (!clearEditedQueueItem(['recurring.create'])) {
			setActionError(DRAFT_CLEANUP_FAILED_MESSAGE);
			finishSavingRecurringTemplate();
			return;
		}
		if (wasEditingQueuedRecurring) {
			resetForm();
			setShowForm(false);
			removeDraft(draftKey);
		}
		setActionSuccess(
			editingRecurringExpense
				? 'Fixkosten-Vorlage aktualisiert.'
				: 'Als monatliche Vorlage gespeichert.',
		);
		finishSavingRecurringTemplate();
	}

	async function createFromRecurringTemplate(template: RecurringExpense): Promise<void> {
		if (creatingRecurringRef.current) return;
		creatingRecurringRef.current = true;
		const finishCreatingRecurring = () => {
			creatingRecurringRef.current = false;
			setCreatingRecurringId(null);
		};
		setCreatingRecurringId(template.id);
		setActionError(null);
		const createRes = await apiFetch<{ expense: Expense }>(`/api/wg/${encodedShareCode}/expenses`, {
			method: 'POST',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify({
				description: template.description,
				amountCents: template.amountCents,
				paidByMemberId: template.paidByMemberId,
				splits: template.splits,
			}),
		});
		if (!createRes.ok) {
			if (createRes.status === 0) {
				const queuedCount = enqueueOfflineAction(
					createQueuedExpense({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						description: template.description,
						amountCents: template.amountCents,
						paidByMemberId: template.paidByMemberId,
						splits: template.splits,
						recurringExpenseId: template.id,
						expectedRecurringNextDueAt: template.nextDueAt,
					}),
				);
				if (queuedCount === 0) {
					setActionError(
						'Offline-Speicher ist blockiert. Die Fixkosten-Ausgabe konnte nicht vorgemerkt werden.',
					);
					finishCreatingRecurring();
					return;
				}
				refreshCount();
				setActionWarning(
					'Fixkosten-Ausgabe offline vorgemerkt. Die Vorlage bleibt bis zur Synchronisierung unverändert.',
				);
				finishCreatingRecurring();
				return;
			}
			setActionError('Fixkosten-Ausgabe konnte nicht erstellt werden: Versuche es gleich erneut.');
			finishCreatingRecurring();
			return;
		}
		setExpenses((current) => [
			createRes.data.expense,
			...current.filter((expense) => expense.id !== createRes.data.expense.id),
		]);
		const advanced = await advanceRecurringTemplate(template.id, template.nextDueAt);
		if (advanced) setActionSuccess('Fixkosten-Ausgabe wurde erstellt.');
		finishCreatingRecurring();
		void load(false);
	}

	async function deleteExpense(id: string): Promise<void> {
		if (isPending(id)) return;
		startPending(id);
		setActionError(null);

		const res = await apiFetch<unknown>(
			`/api/wg/${encodedShareCode}/expenses/${encodeURIComponent(id)}`,
			{
				method: 'DELETE',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
			},
		);

		// A 404 means someone else already deleted it, so the row has to go
		// either way — the only difference from success is that we say so.
		const alreadyGone = !res.ok && res.status === 404 && res.error === 'expense_not_found';
		if (!res.ok && !alreadyGone) {
			setActionError(
				res.status === 403
					? 'Nur Zahler:in oder beteiligte Person kann diese Ausgabe entfernen.'
					: expenseActionErrorMessage(res.error),
			);
			endPending(id);
			return;
		}

		setExpenses((current) => current.filter((expense) => expense.id !== id));
		if (alreadyGone) {
			setActionError('Diese Ausgabe existiert nicht mehr und wurde aus der Liste entfernt.');
		}
		endPending(id);
		void load(false);
	}

	async function deleteRecurringTemplate(template: RecurringExpense): Promise<void> {
		if (isPending(template.id)) return;
		startPending(template.id);
		setActionError(null);

		const res = await apiFetch<unknown>(`/api/wg/${encodedShareCode}/recurring-expenses`, {
			method: 'DELETE',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify({ id: template.id }),
		});

		const alreadyGone =
			!res.ok && res.status === 404 && res.error === 'recurring_expense_not_found';
		if (!res.ok && !alreadyGone) {
			setActionError(recurringTemplateDeleteErrorMessage(res.error));
			endPending(template.id);
			return;
		}

		setRecurringExpenses((current) => removeRecurringTemplate(current, template.id));
		if (editingRecurringExpense?.id === template.id) {
			resetForm();
			setShowForm(false);
		}
		if (alreadyGone) {
			setActionError('Diese Fixkosten-Vorlage existiert nicht mehr und wurde entfernt.');
		} else {
			setActionSuccess('Fixkosten-Vorlage gelöscht.');
		}
		endPending(template.id);
		void load(false);
	}

	async function toggleSettle(expenseId: string, split: ExpenseSplit): Promise<void> {
		// Double-click guard: sync check before any async work
		if (isPending(split.id)) return;
		startPending(split.id);
		setActionError(null);
		const settled = split.settledAt === null;

		const res = await apiFetch<unknown>(
			`/api/wg/${encodedShareCode}/expenses/${encodeURIComponent(expenseId)}/splits/${encodeURIComponent(split.id)}/settle`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({ settled }),
			},
		);

		if (!res.ok) {
			if (
				res.status === 404 &&
				(res.error === 'split_not_found' || res.error === 'expense_not_found')
			) {
				setActionError('Diese Zahlung existiert nicht mehr. Die Ausgabenliste wird aktualisiert.');
				void load(false);
			} else {
				setActionError(expenseActionErrorMessage(res.error));
			}
		} else {
			const settledAt = settled ? new Date().toISOString() : null;
			setExpenses((current) =>
				current.map((expense) =>
					expense.id === expenseId
						? {
								...expense,
								splits: expense.splits.map((currentSplit) =>
									currentSplit.id === split.id ? { ...currentSplit, settledAt } : currentSplit,
								),
							}
						: expense,
				),
			);
			void load(false);
		}

		endPending(split.id);
	}

	const showSkeleton = initialLoading && expenses.length === 0;
	const directDebts = useMemo(
		() =>
			computeDirectDebts(
				expenses,
				members.map((member) => ({
					id: member.id,
					name: member.name,
					color: member.color ?? null,
				})),
				payments,
			),
		[expenses, members, payments],
	);
	const memberBalances = useMemo(
		() =>
			computeNetBalances(
				expenses,
				members.map((member) => ({
					id: member.id,
					name: member.name,
					color: member.color ?? null,
				})),
				payments,
			).map(({ cents, ...member }) => ({ ...member, balanceCents: cents })),
		[expenses, members, payments],
	);
	const settlementSummary = useMemo(
		() =>
			buildSettlementSummary(
				expenses,
				members.map((member) => ({
					id: member.id,
					name: member.name,
					color: member.color ?? null,
				})),
				payments,
			),
		[expenses, members, payments],
	);
	const selectedRecurringExpense = useMemo(
		() => recurringExpenses.find((item) => item.id === recurringId) ?? null,
		[recurringExpenses, recurringId],
	);
	const visibleRecurringExpenses = useMemo(() => {
		if (recurringFilterActive) return recurringExpenses;
		const firstItems = recurringExpenses.slice(0, 4);
		if (
			!selectedRecurringExpense ||
			firstItems.some((item) => item.id === selectedRecurringExpense.id)
		) {
			return firstItems;
		}
		return [selectedRecurringExpense, ...firstItems].slice(0, 4);
	}, [recurringExpenses, recurringFilterActive, selectedRecurringExpense]);
	const hiddenRecurringCount = recurringExpenses.length - visibleRecurringExpenses.length;
	const isEditingQueuedExpense = queueEditType === 'expense.create';
	const isEditingQueuedRecurring = queueEditType === 'recurring.create';
	const formSaving = submitting || savingRecurringTemplate;
	const recurringActionPending = creatingRecurringId !== null || savingRecurringTemplate;
	const previewAmount = parseEuroAmount(amountStr);
	const splitPreview =
		previewAmount !== null && previewAmount >= AMOUNT_MIN_EUROS && previewAmount <= AMOUNT_MAX_EUROS
			? buildSplits(Math.round(previewAmount * CENTS_PER_EURO))
			: null;

	return (
		<div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
			<AusgabenHeader
				expenseCount={expenses.length}
				initialLoading={initialLoading}
				showForm={showForm}
				wgBaseHref={wgBaseHref}
				onToggleForm={() => {
					if (showForm) {
						setShowForm(false);
					} else {
						haptic('light');
						setShowForm(true);
					}
				}}
			/>

			{/* Fixkosten und Mahnungen sind keine eigenen Bereiche, sondern zwei
			    Sichten auf dieselben Ausgaben — deshalb hängen sie hier und nicht
			    im Mehr-Menü. */}
			<SubNav
				label="Unterbereiche der Ausgaben"
				items={[
					{
						href: `${wgBaseHref}/abos`,
						label: 'Fixkosten',
						icon: RefreshCw,
						count: recurringExpenses.length,
					},
					{
						href: `${wgBaseHref}/mahnungen`,
						label: 'Mahnungen',
						icon: Bell,
						count: directDebts.length,
					},
				]}
			/>

			{showForm && (
				<ExpenseFormSection
					previewSplits={splitPreview?.ok ? splitPreview.splits : null}
					pendingPrefillDescription={pendingPrefill?.description ?? null}
					onReplacePrefill={acceptPendingPrefill}
					onDiscard={() => {
						resetForm();
						setShowForm(false);
						removeDraft(draftKey);
					}}
					isEditingExpense={editingExpense !== null}
					description={description}
					setDescription={setDescription}
					amountStr={amountStr}
					setAmountStr={setAmountStr}
					paidByMemberId={paidByMemberId}
					setPaidByMemberId={setPaidByMemberId}
					members={members}
					payerOptions={selectablePayers}
					splitCandidates={selectableSplitMembers}
					identityMemberId={identity.memberId}
					splitMode={splitMode}
					setSplitMode={setSplitMode}
					recurringIntervalMonths={recurringIntervalMonths}
					setRecurringIntervalMonths={setRecurringIntervalMonths}
					manualSplits={manualSplits}
					setManualSplits={setManualSplits}
					imageUrl={imageUrl}
					setImageUrl={setImageUrl}
					shareCode={wg.shareCode}
					isEditingQueuedExpense={isEditingQueuedExpense}
					isEditingQueuedRecurring={isEditingQueuedRecurring}
					formError={formError}
					conflictExpenseId={conflictExpenseId}
					onReloadServerVersion={() => {
						setConflictExpenseId(null);
						setFormError(null);
						void load(false);
					}}
					onKeepDraft={() => setConflictExpenseId(null)}
					savingRecurringTemplate={savingRecurringTemplate}
					editingRecurringExpense={editingRecurringExpense}
					formSaving={formSaving}
					onSaveRecurringTemplate={() => void saveRecurringTemplate()}
					onCancel={() => {
						setShowForm(false);
					}}
					onSubmit={() => {
						haptic('medium');
						if (isEditingQueuedRecurring) void saveRecurringTemplate();
						else void submit();
					}}
				/>
			)}

			{actionNotice && <ActionNoticeBanner notice={actionNotice} />}

			{refreshing && (
				<output
					className="flex justify-center py-1"
					aria-label="Aktualisieren…"
					aria-live="polite"
					aria-atomic="true"
				>
					<Loader2 className="h-4 w-4 animate-spin text-[var(--text-3)]" aria-hidden />
				</output>
			)}

			<OfflineQueueNotice queuedCount={queuedCount} />

			{loadError && (
				<div role="alert" className={ALERT_DANGER_ROW}>
					<span>{loadError}</span>
					<button
						type="button"
						onClick={() => void load(true)}
						disabled={initialLoading || refreshing}
						className="inline-flex h-11 items-center gap-1.5 rounded-md border border-[var(--danger)]/30 px-3 text-[12px] font-medium transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
					>
						<RotateCw
							className={`h-3.5 w-3.5 ${initialLoading || refreshing ? 'animate-spin' : ''}`}
							aria-hidden
						/>
						{initialLoading || refreshing ? 'Lädt...' : 'Ausgaben erneut laden'}
					</button>
				</div>
			)}

			{(recurringExpenses.length > 0 || recurringFilterActive) && (
				<RecurringExpensesSection
					recurringExpenses={recurringExpenses}
					recurringFilterActive={recurringFilterActive}
					wgBaseHref={wgBaseHref}
					shareCode={wg.shareCode}
					hiddenRecurringCount={hiddenRecurringCount}
					visibleRecurringExpenses={visibleRecurringExpenses}
					recurringId={recurringId}
					recurringActionPending={recurringActionPending}
					creatingRecurringId={creatingRecurringId}
					isPending={isPending}
					onCreateFromTemplate={(item) => void createFromRecurringTemplate(item)}
					onEditTemplate={startRecurringEdit}
					onDeleteTemplate={(item) => void deleteRecurringTemplate(item)}
					onPrepareNewExpense={() => setShowForm(true)}
				/>
			)}

			{!showSkeleton && expenses.length > 0 && (
				<Panel title="Saldo pro Mitglied">
					<BalanceBars balances={memberBalances} currentMemberId={identity.memberId} />
				</Panel>
			)}

			{!showSkeleton && (
				<DebtSummary
					expenses={expenses}
					debts={directDebts}
					summary={settlementSummary}
					shareCode={wg.shareCode}
					currentMemberId={identity.memberId}
					memberToken={identity.memberToken}
					memberColor={memberColor}
					memberPayPalMerchantId={memberPayPalMerchantId}
					onSettled={(message) => {
						if (message) setActionSuccess(message);
						void load(false);
					}}
				/>
			)}

			{showSkeleton ? (
				<ExpensesSkeleton />
			) : loadError && expenses.length === 0 ? (
				<p className={EMPTY_PLACEHOLDER}>Noch keine Ausgaben geladen. Versuche es erneut.</p>
			) : expenses.length === 0 && !initialLoading ? (
				// Formular offen → Empty-State samt Template-Buttons ausblenden,
				// sonst stehen zwei konkurrierende CTAs unter dem Formular.
				showForm ? null : (
					<>
						<EmptyState
							icon={<Receipt className="h-5 w-5" strokeWidth={1.5} aria-hidden />}
							headline="Noch keine Ausgaben"
							sub="Leg die erste Ausgabe an oder starte mit einer typischen WG-Ausgabe."
							cta={{ label: 'Erste Ausgabe', onClick: () => setShowForm(true) }}
						/>
						<div className="-mt-4 flex flex-wrap justify-center gap-2">
							{QUICK_EXPENSE_TEMPLATES.map((t) => (
								<button
									key={t.label}
									type="button"
									onClick={() => applyQuickExpense(t)}
									className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-1.5 text-[13px] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)]"
								>
									{t.label}
								</button>
							))}
						</div>
					</>
				)
			) : (
				<details
					open={Boolean(highlightedId)}
					className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4"
				>
					<summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
						<span className="text-sm font-semibold text-[var(--text-1)]">
							Eingetragene Ausgaben
						</span>
						<span className="flex items-center gap-2">
							<span className="rounded-full border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-3)]">
								{expenses.length}
							</span>
							<ChevronDown className="h-4 w-4 text-[var(--text-3)]" aria-hidden />
						</span>
					</summary>
					<ul className={`${LIST_CARD} mt-3`}>
						{expenses.map((e) => (
							<ExpenseRow
								key={e.id}
								expense={e}
								expanded={expanded.has(e.id)}
								onToggleExpand={toggleExpand}
								onDelete={deleteExpense}
								onEdit={startEdit}
								onToggleSettle={toggleSettle}
								isPending={isPending}
								memberName={memberName}
								memberColor={memberColor}
								currentMemberId={identity.memberId}
								highlighted={highlightedId === e.id}
							/>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}
