'use client';

import {
	buildDraftKey,
	isEmptyModuleDraft,
	readDraft,
	removeDraft,
	writeDraft,
} from '@/core/offline/drafts';
import type { OfflineActionType } from '@/core/offline/offline-queue';
import { formatEuroInput, parseEuroAmount } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { buildExpensePrefillDraft } from '@/features/expenses/expense-prefill';
import { isEqualExpenseSplit } from '@/features/expenses/expense-split-input';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	type ExpenseDraft,
	type ExpenseEditReference,
	type ExpenseSuggestion,
	type SplitMode,
	parseDraftEditTarget,
	recurringTemplateSuggestion,
	splitsToManualInput,
} from './expense-form-draft';
import type { Expense, RecurringExpense } from './expense-types';

function isEqualQueuedSplit(draft: ExpenseDraft, members: readonly FormMember[]): boolean {
	const amount = parseEuroAmount(draft.amountStr ?? '');
	if (amount === null || !draft.manualSplits) return false;
	const splits = Object.entries(draft.manualSplits).flatMap(([debtorMemberId, value]) => {
		const share = parseEuroAmount(value);
		return share === null
			? []
			: [{ debtorMemberId, amountCents: Math.round(share * CENTS_PER_EURO) }];
	});
	return isEqualExpenseSplit(Math.round(amount * CENTS_PER_EURO), splits, members);
}

/** The member fields this hook reads; structural so it needs no WG context provider. */
interface FormMember {
	id: string;
	active: boolean;
}

interface UseExpenseFormOptions {
	shareCode: string;
	members: readonly FormMember[];
	identityMemberId: string;
	// URL handoffs preserve an existing draft until the resident explicitly replaces it.
	prefillDescription: string | null;
	prefillAmount: string | null;
	prefillPaidBy: string | null;
	recurringId: string | null;
	/**
	 * Needed to resolve `recurringId`, which names a template that may not be
	 * loaded yet. The effect below re-runs until it appears.
	 */
	recurringExpenses: readonly RecurringExpense[];
}

/**
 * Owns everything the expense form edits: the field values, which entity is
 * being edited, the inline error, and the localStorage draft that survives a
 * reload or an accidental navigation.
 *
 * Its boundary is the `start*`/`reset` entry points below; it needs no loaded data.
 *
 * Deliberately NOT included: `submitting` and the submit handlers. Those talk
 * to the API and to the offline queue, so they belong to a separate seam.
 */
export function useExpenseForm({
	shareCode,
	members,
	identityMemberId,
	prefillDescription,
	prefillAmount,
	prefillPaidBy,
	recurringId,
	recurringExpenses,
}: UseExpenseFormOptions) {
	const [showForm, setShowForm] = useState(false);
	const [description, setDescription] = useState('');
	const [amountStr, setAmountStr] = useState('');
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [paidByMemberId, setPaidByMemberId] = useState<string>(identityMemberId);
	const [splitMode, setSplitMode] = useState<SplitMode>('equal');
	const [manualSplits, setManualSplits] = useState<Record<string, string>>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [conflictExpenseId, setConflictExpenseId] = useState<string | null>(null);
	const [editingExpense, setEditingExpense] = useState<ExpenseEditReference | null>(null);
	const [editingRecurringExpense, setEditingRecurringExpense] = useState<RecurringExpense | null>(
		null,
	);
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const [queueEditType, setQueueEditType] = useState<OfflineActionType | null>(null);
	const [recurringIntervalMonths, setRecurringIntervalMonths] = useState(1);
	const [recurringNextDueAt, setRecurringNextDueAt] = useState<string | null>(null);
	const [draftHydrated, setDraftHydrated] = useState(false);
	const [invalidEditDraft, setInvalidEditDraft] = useState(false);
	const [pendingPrefill, setPendingPrefill] = useState<ExpenseSuggestion | null>(null);
	const [recurringSourceId, setRecurringSourceId] = useState<string | null>(null);

	const draftKey = buildDraftKey(shareCode, identityMemberId, 'expense');
	// Lets the once-per-draft restore read the current members.
	const membersRef = useRef(members);
	membersRef.current = members;
	// Each prefill source applies once per distinct URL so re-renders cannot overwrite edits.
	const appliedPrefillRef = useRef<string | null>(null);
	const appliedRecurringRef = useRef<string | null>(null);
	const prefillKey = `${prefillDescription ?? ''}|${prefillAmount ?? ''}|${prefillPaidBy ?? ''}`;

	// Restore the stored draft once; `draftHydrated` keeps the empty initial state from overwriting it.
	useEffect(() => {
		const draft = readDraft<ExpenseDraft>(draftKey);
		if (!draft) {
			setDraftHydrated(true);
			return;
		}
		// A stored draft restores silently and shows on "Ausgabe hinzufügen"; only "Bearbeiten" from the offline queue opens it directly.
		if (draft.queueEditId && !isEmptyModuleDraft('expense', draft, identityMemberId)) {
			setShowForm(true);
		}
		const target = parseDraftEditTarget(draft.editingExpense);
		if (target.kind === 'valid') {
			setEditingExpense(target.reference);
		} else if (target.kind === 'invalid') {
			setInvalidEditDraft(true);
			setShowForm(true);
			setFormError(
				'Die Zuordnung dieses Entwurfs ist beschädigt. Deine Eingaben bleiben erhalten; öffne die ursprüngliche Ausgabe erneut oder verwirf den Entwurf.',
			);
		}
		if (draft.description) setDescription(draft.description);
		if (draft.amountStr) setAmountStr(draft.amountStr);
		if (draft.imageUrl !== undefined) setImageUrl(draft.imageUrl);
		if (draft.paidByMemberId) setPaidByMemberId(draft.paidByMemberId);
		// Queued expenses always carry per-person amounts; an equal split stays "Gleichmäßig".
		const queuedEqual =
			draft.queueEditId !== undefined &&
			draft.splitMode === 'manual' &&
			isEqualQueuedSplit(draft, membersRef.current);
		if (draft.splitMode) setSplitMode(queuedEqual ? 'equal' : draft.splitMode);
		if (draft.manualSplits && !queuedEqual) setManualSplits(draft.manualSplits);
		if (typeof draft.recurringSourceId === 'string') setRecurringSourceId(draft.recurringSourceId);
		if (draft.queueEditId) setQueueEditId(draft.queueEditId);
		if (draft.queueEditType) setQueueEditType(draft.queueEditType);
		if (draft.recurringIntervalMonths) setRecurringIntervalMonths(draft.recurringIntervalMonths);
		if (draft.recurringNextDueAt) setRecurringNextDueAt(draft.recurringNextDueAt);
		setDraftHydrated(true);
	}, [draftKey, identityMemberId]);

	useEffect(() => {
		if (!draftHydrated) return;
		writeDraft(draftKey, {
			...readDraft<ExpenseDraft>(draftKey),
			recurringSourceId,
			editingExpense: invalidEditDraft ? { invalid: true } : editingExpense,
			description,
			amountStr,
			imageUrl,
			paidByMemberId,
			splitMode,
			manualSplits,
			queueEditId,
			queueEditType,
			recurringIntervalMonths,
			recurringNextDueAt,
		});
	}, [
		amountStr,
		description,
		editingExpense,
		invalidEditDraft,
		draftHydrated,
		draftKey,
		imageUrl,
		manualSplits,
		paidByMemberId,
		queueEditId,
		queueEditType,
		recurringIntervalMonths,
		recurringNextDueAt,
		recurringSourceId,
		splitMode,
	]);

	// A draft can name a member who has since left, or was written while a
	// different identity was active. Falling back to the current user keeps the
	// payer select from showing an empty value.
	useEffect(() => {
		if (!draftHydrated) return;
		if (members.some((m) => m.id === paidByMemberId)) return;
		setPaidByMemberId(identityMemberId);
	}, [draftHydrated, identityMemberId, members, paidByMemberId]);

	const applyPrefill = useCallback(
		(prefill: ExpenseSuggestion): void => {
			writeDraft(draftKey, prefill);
			setRecurringSourceId(prefill.recurringSourceId);
			setRecurringIntervalMonths(1);
			setRecurringNextDueAt(null);
			setConflictExpenseId(null);
			setDescription(prefill.description);
			setAmountStr(prefill.amountStr);
			setImageUrl(prefill.imageUrl);
			setPaidByMemberId(prefill.paidByMemberId);
			setSplitMode(prefill.splitMode);
			setManualSplits(prefill.manualSplits);
			setQueueEditId(null);
			setQueueEditType(null);
			setEditingExpense(null);
			setInvalidEditDraft(false);
			setEditingRecurringExpense(null);
			setFormError(null);
			setPendingPrefill(null);
			setShowForm(true);
		},
		[draftKey],
	);

	const suggestPrefill = useCallback(
		(prefill: ExpenseSuggestion): void => {
			const draft = readDraft<ExpenseDraft>(draftKey);
			if (draft && !isEmptyModuleDraft('expense', draft, identityMemberId)) {
				setPendingPrefill(prefill);
				setShowForm(true);
			} else {
				applyPrefill(prefill);
			}
		},
		[applyPrefill, draftKey, identityMemberId],
	);

	// A handoff is a new draft, so it must not overwrite unfinished input.
	useEffect(() => {
		if (recurringId) return;
		const prefill = buildExpensePrefillDraft({
			description: prefillDescription,
			amount: prefillAmount,
			paidByMemberId: members.find((member) => member.id === prefillPaidBy)?.id ?? identityMemberId,
		});
		if (!prefill || appliedPrefillRef.current === prefillKey) return;
		appliedPrefillRef.current = prefillKey;
		suggestPrefill({ ...prefill, recurringSourceId: null });
	}, [
		suggestPrefill,
		identityMemberId,
		members,
		prefillAmount,
		prefillDescription,
		prefillPaidBy,
		prefillKey,
		recurringId,
	]);

	// `?recurring=<id>` — turns a due fixed cost into a prefilled one-off
	// expense. This creates a NEW expense from the template, so it must not set
	// `editingRecurringExpense`.
	useEffect(() => {
		if (!recurringId) return;
		if (appliedRecurringRef.current === recurringId) return;
		const template = recurringExpenses.find((item) => item.id === recurringId);
		if (!template) return;
		appliedRecurringRef.current = recurringId;
		suggestPrefill(recurringTemplateSuggestion(template));
	}, [suggestPrefill, recurringExpenses, recurringId]);

	function resetForm(): void {
		removeDraft(draftKey);
		setRecurringSourceId(null);
		setDescription('');
		setAmountStr('');
		setImageUrl(null);
		setPaidByMemberId(identityMemberId);
		setSplitMode('equal');
		setManualSplits({});
		setFormError(null);
		setConflictExpenseId(null);
		setEditingExpense(null);
		setInvalidEditDraft(false);
		setEditingRecurringExpense(null);
		setQueueEditId(null);
		setQueueEditType(null);
		setRecurringIntervalMonths(1);
		setRecurringNextDueAt(null);
		setPendingPrefill(null);
	}

	function startEdit(expense: Expense): void {
		setRecurringSourceId(null);
		setPendingPrefill(null);
		setDescription(expense.description);
		setAmountStr(formatEuroInput(expense.amountCents / CENTS_PER_EURO));
		setImageUrl(expense.imageUrl);
		setPaidByMemberId(expense.paidByMemberId);
		// "Equal" only if the splits cover EVERY current member and each share matches what
		// largest-remainder rounding produces for the same (amount, member order) pair; shares
		// that merely differ by a cent, or a missing member, are a manual split.
		const isEqual = isEqualExpenseSplit(expense.amountCents, expense.splits, members);
		if (isEqual) {
			setSplitMode('equal');
			setManualSplits({});
		} else {
			setSplitMode('manual');
			setManualSplits(splitsToManualInput(expense.splits));
		}
		setFormError(null);
		setConflictExpenseId(null);
		setQueueEditId(null);
		setQueueEditType(null);
		setEditingExpense({ id: expense.id, updatedAt: expense.updatedAt, currency: expense.currency });
		setInvalidEditDraft(false);
		setShowForm(true);
	}

	/** Keeps the draft; the next save checks against the current server version. */
	function rebaseEdit(updatedAt: string): void {
		setEditingExpense((current) => (current ? { ...current, updatedAt } : current));
	}

	function startRecurringEdit(template: RecurringExpense): void {
		setRecurringSourceId(null);
		setPendingPrefill(null);
		setDescription(template.description);
		setAmountStr(formatEuroInput(template.amountCents / CENTS_PER_EURO));
		setImageUrl(null);
		setPaidByMemberId(template.paidByMemberId);
		// A template stores explicit per-member shares, so editing it always
		// starts in manual mode even when the shares happen to be equal.
		setSplitMode('manual');
		setManualSplits(splitsToManualInput(template.splits));
		setRecurringIntervalMonths(template.intervalMonths);
		setEditingExpense(null);
		setInvalidEditDraft(false);
		setEditingRecurringExpense(template);
		setQueueEditId(null);
		setQueueEditType(null);
		setFormError(null);
		setShowForm(true);
	}

	return {
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
		// Read-only: `startEdit` enters edit mode and `resetForm` leaves it.
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
		acceptPendingPrefill: () => {
			if (pendingPrefill) applyPrefill(pendingPrefill);
		},
		resetForm,
		startEdit,
		rebaseEdit,
		startRecurringEdit,
	};
}
