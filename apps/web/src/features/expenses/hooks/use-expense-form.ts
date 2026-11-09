'use client';

import { useLocale } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	buildDraftKey,
	isEmptyModuleDraft,
	readDraft,
	removeDraft,
	writeDraft,
} from '@/core/offline/drafts';
import { formatCentsInput } from '@/core/utils/amount';
import { isoToInputDate } from '@/core/utils/local-date';
import {
	type ExpenseDraft,
	type ExpenseEditReference,
	type ExpenseSuggestion,
	parseDraftEditTarget,
	participantsOrAll,
	queuedEqualParticipants,
	type SplitMode,
	splitsToManualInput,
} from '@/features/expenses/expense-form-draft';
import { equalSplitParticipants } from '@/features/expenses/expense-split-input';
import type { Expense, RecurringExpense } from '@/features/expenses/expense-types';
import { useExpenseCategory } from '@/features/expenses/hooks/use-expense-category';
import { useExpenseFormExtras } from '@/features/expenses/hooks/use-expense-form-extras';
import {
	type ExpensePrefillParams,
	useExpensePrefillHandoff,
} from '@/features/expenses/hooks/use-expense-prefill-handoff';
import { useExpenseQueuedFields } from '@/features/expenses/hooks/use-expense-queued-fields';
import type { Message } from '@/shared/i18n/message';

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
	prefill: ExpensePrefillParams;
	recurringId: string | null;
	/** The loaded expenses, newest first; the default category is read from them. */
	expenses: readonly Pick<Expense, 'description' | 'category' | 'paidByMemberId'>[];
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
	prefill: prefillParams,
	recurringId,
	expenses,
	recurringExpenses,
}: UseExpenseFormOptions) {
	const locale = useLocale();
	const [showForm, setShowForm] = useState(false);
	const [description, setDescriptionState] = useState('');
	const categoryState = useExpenseCategory(identityMemberId, expenses);
	const { category, setCategory } = categoryState;
	const [amountStr, setAmountStr] = useState('');
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [paidByMemberId, setPaidByMemberId] = useState<string>(identityMemberId);
	const [splitMode, setSplitMode] = useState<SplitMode>('equal');
	const [manualSplits, setManualSplits] = useState<Record<string, string>>({});
	const [formError, setFormError] = useState<Message | null>(null);
	const [conflictExpenseId, setConflictExpenseId] = useState<string | null>(null);
	const [editingExpense, setEditingExpense] = useState<ExpenseEditReference | null>(null);
	const [editingRecurringExpense, setEditingRecurringExpense] = useState<RecurringExpense | null>(
		null,
	);
	const {
		draftFields: queuedDraftFields,
		clear: clearQueued,
		restore: restoreQueued,
		...queued
	} = useExpenseQueuedFields();
	const { queueEditId, setRecurringIntervalMonths } = queued;
	const [draftHydrated, setDraftHydrated] = useState(false);
	const [invalidEditDraft, setInvalidEditDraft] = useState(false);
	const [pendingPrefill, setPendingPrefill] = useState<ExpenseSuggestion | null>(null);
	const [recurringSourceId, setRecurringSourceId] = useState<string | null>(null);
	const extras = useExpenseFormExtras();
	const { restore: restoreCategory } = categoryState;

	const draftKey = buildDraftKey(shareCode, identityMemberId, 'expense');
	// Lets the once-per-draft restore read the current members.
	const membersRef = useRef(members);
	membersRef.current = members;

	/** Typing a description known from earlier expenses pre-selects its category. */
	function setDescription(next: string): void {
		setDescriptionState(next);
		if (!editingExpense && !editingRecurringExpense && !queueEditId && !recurringSourceId) {
			categoryState.followDescription(next);
		}
	}

	// Restore the stored draft once; `draftHydrated` keeps the empty initial state from overwriting it.
	useEffect(() => {
		const draft = readDraft<ExpenseDraft>(draftKey);
		if (!draft) {
			setDraftHydrated(true);
			return;
		}
		// A stored draft restores silently and shows when the add form opens; only editing from the offline queue opens it directly.
		if (draft.queueEditId && !isEmptyModuleDraft('expense', draft, identityMemberId)) {
			setShowForm(true);
		}
		const target = parseDraftEditTarget(draft.editingExpense);
		if (target.kind === 'valid') {
			setEditingExpense(target.reference);
		} else if (target.kind === 'invalid') {
			setInvalidEditDraft(true);
			setShowForm(true);
			setFormError({ key: 'expenses-form.notices.draftBrokenKept' });
		}
		if (draft.description) setDescriptionState(draft.description);
		// A draft is untrusted storage; only known category codes are restored.
		restoreCategory(draft);
		if (draft.amountStr) setAmountStr(draft.amountStr);
		if (draft.imageUrl !== undefined) setImageUrl(draft.imageUrl);
		if (draft.paidByMemberId) setPaidByMemberId(draft.paidByMemberId);
		// Queued expenses always carry per-person amounts; an equal split stays an equal split.
		const queuedParticipants =
			draft.queueEditId !== undefined && draft.splitMode === 'manual'
				? queuedEqualParticipants(draft, membersRef.current, locale)
				: null;
		const queuedEqual = queuedParticipants !== null;
		if (draft.splitMode) setSplitMode(queuedEqual ? 'equal' : draft.splitMode);
		if (draft.manualSplits && !queuedEqual) setManualSplits(draft.manualSplits);
		// An untouched form opens on today, not on the day it was last open.
		extras.restore(
			isEmptyModuleDraft('expense', draft, identityMemberId)
				? { ...draft, occurredOn: null }
				: draft,
		);
		if (queuedParticipants) {
			extras.setParticipantIds(participantsOrAll(queuedParticipants, membersRef.current));
		}
		if (typeof draft.recurringSourceId === 'string') setRecurringSourceId(draft.recurringSourceId);
		restoreQueued(draft);
		setDraftHydrated(true);
	}, [
		draftKey,
		identityMemberId,
		extras.restore,
		extras.setParticipantIds,
		locale,
		restoreCategory,
		restoreQueued,
	]);

	useEffect(() => {
		if (!draftHydrated) return;
		writeDraft(draftKey, {
			...readDraft<ExpenseDraft>(draftKey),
			recurringSourceId,
			editingExpense: invalidEditDraft ? { invalid: true } : editingExpense,
			description,
			category,
			lastCategory: categoryState.lastCategory,
			amountStr,
			imageUrl,
			paidByMemberId,
			splitMode,
			manualSplits,
			...extras.draftFields,
			...queuedDraftFields,
		});
	}, [
		extras.draftFields,
		amountStr,
		category,
		categoryState.lastCategory,
		description,
		editingExpense,
		invalidEditDraft,
		draftHydrated,
		draftKey,
		imageUrl,
		manualSplits,
		paidByMemberId,
		queuedDraftFields,
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

	const { applyPrefill: applyCategoryPrefill } = categoryState;
	const applyPrefill = useCallback(
		(prefill: ExpenseSuggestion): void => {
			writeDraft(draftKey, prefill);
			setRecurringSourceId(prefill.recurringSourceId);
			clearQueued();
			setConflictExpenseId(null);
			setDescriptionState(prefill.description);
			applyCategoryPrefill(prefill.description, prefill.category);
			setAmountStr(prefill.amountStr);
			setImageUrl(prefill.imageUrl);
			setPaidByMemberId(prefill.paidByMemberId);
			setSplitMode(prefill.splitMode);
			setManualSplits(prefill.manualSplits);
			extras.reset();
			setEditingExpense(null);
			setInvalidEditDraft(false);
			setEditingRecurringExpense(null);
			setFormError(null);
			setPendingPrefill(null);
			setShowForm(true);
		},
		[draftKey, extras.reset, applyCategoryPrefill, clearQueued],
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
		prefill: prefillParams,
		recurringId,
		recurringExpenses,
		locale,
	});

	function resetForm(): void {
		removeDraft(draftKey);
		setRecurringSourceId(null);
		setDescriptionState('');
		categoryState.reset();
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
		clearQueued();
		setPendingPrefill(null);
	}

	function startEdit(expense: Expense): void {
		setRecurringSourceId(null);
		setPendingPrefill(null);
		setDescriptionState(expense.description);
		setCategory(expense.category);
		setAmountStr(formatCentsInput(expense.amountCents, locale));
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
			setManualSplits(splitsToManualInput(expense.splits, locale));
		}
		setFormError(null);
		setConflictExpenseId(null);
		clearQueued();
		setEditingExpense({ id: expense.id, updatedAt: expense.updatedAt, currency: expense.currency });
		setEditingRecurringExpense(null);
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
		setDescriptionState(template.description);
		setCategory(template.category);
		setAmountStr(formatCentsInput(template.amountCents, locale));
		setImageUrl(null);
		setPaidByMemberId(template.paidByMemberId);
		// A template stores explicit per-member shares, so editing it always
		// starts in manual mode even when the shares happen to be equal.
		setSplitMode('manual');
		setManualSplits(splitsToManualInput(template.splits, locale));
		extras.reset();
		clearQueued();
		setRecurringIntervalMonths(template.intervalMonths);
		setEditingExpense(null);
		setInvalidEditDraft(false);
		setEditingRecurringExpense(template);
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
		emptyCategory: categoryState.emptyCategory,
		rememberCategory: categoryState.remember,
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
		...queued,
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
