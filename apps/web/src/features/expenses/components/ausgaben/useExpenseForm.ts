'use client';

import {
	buildDraftKey,
	isEmptyModuleDraft,
	readDraft,
	removeDraft,
	writeDraft,
} from '@/core/offline/drafts';
import type { OfflineActionType } from '@/core/offline/offline-queue';
import { formatEuroInput } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import {
	DEFAULT_EXPENSE_CATEGORY,
	EXPENSE_CATEGORIES,
	type ExpenseCategory,
} from '@/features/expenses/expense-categories';
import { equalSplitParticipants } from '@/features/expenses/expense-split-input';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	type ExpenseDraft,
	type ExpenseEditReference,
	type ExpenseSuggestion,
	type SplitMode,
	parseDraftEditTarget,
	participantsOrAll,
	queuedEqualParticipants,
	splitsToManualInput,
} from './expense-form-draft';
import type { Expense, RecurringExpense } from './expense-types';
import { isoToInputDate, useExpenseFormExtras } from './use-expense-form-extras';
import { useExpensePrefillHandoff } from './use-expense-prefill-handoff';

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
	const [category, setCategory] = useState<ExpenseCategory>(DEFAULT_EXPENSE_CATEGORY);
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
	const extras = useExpenseFormExtras();

	const draftKey = buildDraftKey(shareCode, identityMemberId, 'expense');
	// Lets the once-per-draft restore read the current members.
	const membersRef = useRef(members);
	membersRef.current = members;

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
		// A draft is untrusted storage; only known category codes are restored.
		const draftCategory = EXPENSE_CATEGORIES.find((code) => code === draft.category);
		if (draftCategory) setCategory(draftCategory);
		if (draft.amountStr) setAmountStr(draft.amountStr);
		if (draft.imageUrl !== undefined) setImageUrl(draft.imageUrl);
		if (draft.paidByMemberId) setPaidByMemberId(draft.paidByMemberId);
		// Queued expenses always carry per-person amounts; an equal split stays "Gleichmäßig".
		const queuedParticipants =
			draft.queueEditId !== undefined && draft.splitMode === 'manual'
				? queuedEqualParticipants(draft, membersRef.current)
				: null;
		const queuedEqual = queuedParticipants !== null;
		if (draft.splitMode) setSplitMode(queuedEqual ? 'equal' : draft.splitMode);
		if (draft.manualSplits && !queuedEqual) setManualSplits(draft.manualSplits);
		extras.restore(draft);
		if (queuedParticipants) {
			extras.setParticipantIds(participantsOrAll(queuedParticipants, membersRef.current));
		}
		if (typeof draft.recurringSourceId === 'string') setRecurringSourceId(draft.recurringSourceId);
		if (draft.queueEditId) setQueueEditId(draft.queueEditId);
		if (draft.queueEditType) setQueueEditType(draft.queueEditType);
		if (draft.recurringIntervalMonths) setRecurringIntervalMonths(draft.recurringIntervalMonths);
		if (draft.recurringNextDueAt) setRecurringNextDueAt(draft.recurringNextDueAt);
		setDraftHydrated(true);
	}, [draftKey, identityMemberId, extras.restore, extras.setParticipantIds]);

	useEffect(() => {
		if (!draftHydrated) return;
		writeDraft(draftKey, {
			...readDraft<ExpenseDraft>(draftKey),
			recurringSourceId,
			editingExpense: invalidEditDraft ? { invalid: true } : editingExpense,
			description,
			category,
			amountStr,
			imageUrl,
			paidByMemberId,
			splitMode,
			manualSplits,
			...extras.draftFields,
			queueEditId,
			queueEditType,
			recurringIntervalMonths,
			recurringNextDueAt,
		});
	}, [
		extras.draftFields,
		amountStr,
		category,
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
			setCategory(prefill.category ?? DEFAULT_EXPENSE_CATEGORY);
			setAmountStr(prefill.amountStr);
			setImageUrl(prefill.imageUrl);
			setPaidByMemberId(prefill.paidByMemberId);
			setSplitMode(prefill.splitMode);
			setManualSplits(prefill.manualSplits);
			extras.reset();
			setQueueEditId(null);
			setQueueEditType(null);
			setEditingExpense(null);
			setInvalidEditDraft(false);
			setEditingRecurringExpense(null);
			setFormError(null);
			setPendingPrefill(null);
			setShowForm(true);
		},
		[draftKey, extras.reset],
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

	useExpensePrefillHandoff({
		suggestPrefill,
		members,
		identityMemberId,
		prefillDescription,
		prefillAmount,
		prefillPaidBy,
		recurringId,
		recurringExpenses,
	});

	function resetForm(): void {
		removeDraft(draftKey);
		setRecurringSourceId(null);
		setDescription('');
		setCategory(DEFAULT_EXPENSE_CATEGORY);
		setAmountStr('');
		setImageUrl(null);
		setPaidByMemberId(identityMemberId);
		setSplitMode('equal');
		setManualSplits({});
		extras.reset();
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
		setCategory(expense.category);
		setAmountStr(formatEuroInput(expense.amountCents / CENTS_PER_EURO));
		setImageUrl(expense.imageUrl);
		setPaidByMemberId(expense.paidByMemberId);
		// "Equal" only if every share is an equal part among active members (all or a subset), as
		// largest-remainder rounding produces it; shares that differ by a cent, or a moved-out
		// member's share, make it a manual split.
		const participants = equalSplitParticipants(expense.amountCents, expense.splits, members);
		extras.load({
			occurredOn: isoToInputDate(expense.occurredAt),
			participantIds: participants ? participantsOrAll(participants, members) : null,
		});
		if (participants) {
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
		setCategory(template.category);
		setAmountStr(formatEuroInput(template.amountCents / CENTS_PER_EURO));
		setImageUrl(null);
		setPaidByMemberId(template.paidByMemberId);
		// A template stores explicit per-member shares, so editing it always
		// starts in manual mode even when the shares happen to be equal.
		setSplitMode('manual');
		setManualSplits(splitsToManualInput(template.splits));
		extras.reset();
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
		category,
		setCategory,
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
		extras,
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
