'use client';

import { buildDraftKey, readDraft, writeDraft } from '@/core/offline/drafts';
import type { OfflineActionType } from '@/core/offline/offline-queue';
import { formatEuroInput } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { parseTimestamp } from '@/core/utils/time';
import { buildExpensePrefillDraft } from '@/features/expenses/expense-prefill';
import { distributeCentsEqually } from '@/features/expenses/split-math';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DESCRIPTION_MAX, type QUICK_EXPENSE_TEMPLATES } from './constants';
import type { Expense, RecurringExpense } from './expense-types';

export type SplitMode = 'equal' | 'manual';

/**
 * Only the fields this hook actually reads. Kept structural rather than
 * importing the WG context's `Member` so the hook stays testable without a
 * provider — every caller passes something wider, which is fine.
 */
interface FormMember {
	id: string;
}

/**
 * What a restored draft may contain. Everything is optional because the draft
 * is user-controlled localStorage data from a possibly older app version.
 *
 * A `type` rather than an `interface` on purpose: only type aliases get the
 * implicit index signature that `readDraft`'s `Record<string, unknown>`
 * constraint requires.
 */
type ExpenseDraft = {
	editingExpense?: unknown;
	description?: string;
	amountStr?: string;
	imageUrl?: string | null;
	paidByMemberId?: string;
	splitMode?: SplitMode;
	manualSplits?: Record<string, string>;
	queueEditId?: string;
	queueEditType?: OfflineActionType;
	recurringIntervalMonths?: number;
	recurringNextDueAt?: string;
};

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
 * Extracted from the page component, which held 27 `useState` calls and made
 * this logic reachable only through full-page render tests. The form is the
 * largest self-contained cluster in there — it has a real boundary (the four
 * `start*`/`reset` entry points below) and no dependency on loaded data.
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
	const [editingExpense, setEditingExpense] = useState<Pick<Expense, 'id' | 'updatedAt'> | null>(
		null,
	);
	const [editingRecurringExpense, setEditingRecurringExpense] = useState<RecurringExpense | null>(
		null,
	);
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const [queueEditType, setQueueEditType] = useState<OfflineActionType | null>(null);
	const [recurringIntervalMonths, setRecurringIntervalMonths] = useState(1);
	const [recurringNextDueAt, setRecurringNextDueAt] = useState<string | null>(null);
	const [draftHydrated, setDraftHydrated] = useState(false);
	const [invalidEditDraft, setInvalidEditDraft] = useState(false);
	const [pendingPrefill, setPendingPrefill] =
		useState<ReturnType<typeof buildExpensePrefillDraft>>(null);

	const draftKey = buildDraftKey(shareCode, identityMemberId, 'expense');
	// Both prefill sources apply once per distinct URL. Without these guards,
	// re-renders (or a reload that re-resolves the template) would keep
	// stomping over edits the user has since made in the open form.
	const appliedPrefillRef = useRef<string | null>(null);
	const appliedRecurringRef = useRef<string | null>(null);
	const prefillKey = `${prefillDescription ?? ''}|${prefillAmount ?? ''}|${prefillPaidBy ?? ''}`;

	// Restore the stored draft once, before the first write-back runs — that
	// ordering is what `draftHydrated` guards. Without it the empty initial
	// state would overwrite the draft on mount.
	useEffect(() => {
		const draft = readDraft<ExpenseDraft>(draftKey);
		if (!draft) {
			setDraftHydrated(true);
			return;
		}
		// Open the form only for a draft the user would recognize. A draft
		// holding nothing but defaults would otherwise pop the form open on
		// every visit.
		const hasRestorableDraft = Boolean(
			draft.description ||
				draft.amountStr ||
				(draft.imageUrl !== undefined && draft.imageUrl !== null) ||
				draft.queueEditId ||
				draft.recurringNextDueAt,
		);
		if (hasRestorableDraft) setShowForm(true);
		const target = draft.editingExpense;
		if (target !== undefined && target !== null) {
			if (
				typeof target === 'object' &&
				'id' in target &&
				typeof target.id === 'string' &&
				/^[a-z0-9-]{1,128}$/i.test(target.id) &&
				'updatedAt' in target &&
				typeof target.updatedAt === 'string' &&
				parseTimestamp(target.updatedAt) !== null
			) {
				setEditingExpense({ id: target.id, updatedAt: target.updatedAt });
			} else {
				setInvalidEditDraft(true);
				setShowForm(true);
				setFormError(
					'Die Zuordnung dieses Entwurfs ist beschädigt. Deine Eingaben bleiben erhalten; öffne die ursprüngliche Ausgabe erneut oder verwirf den Entwurf.',
				);
			}
		}
		if (draft.description) setDescription(draft.description);
		if (draft.amountStr) setAmountStr(draft.amountStr);
		if (draft.imageUrl !== undefined) setImageUrl(draft.imageUrl);
		if (draft.paidByMemberId) setPaidByMemberId(draft.paidByMemberId);
		if (draft.splitMode) setSplitMode(draft.splitMode);
		if (draft.manualSplits) setManualSplits(draft.manualSplits);
		if (draft.queueEditId) setQueueEditId(draft.queueEditId);
		if (draft.queueEditType) setQueueEditType(draft.queueEditType);
		if (draft.recurringIntervalMonths) setRecurringIntervalMonths(draft.recurringIntervalMonths);
		if (draft.recurringNextDueAt) setRecurringNextDueAt(draft.recurringNextDueAt);
		setDraftHydrated(true);
	}, [draftKey]);

	useEffect(() => {
		if (!draftHydrated) return;
		writeDraft(draftKey, {
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
		(prefill: NonNullable<ReturnType<typeof buildExpensePrefillDraft>>): void => {
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
		[],
	);

	// A handoff is a new draft, so it must not overwrite unfinished input.
	useEffect(() => {
		const prefill = buildExpensePrefillDraft({
			description: prefillDescription,
			amount: prefillAmount,
			paidByMemberId: members.find((member) => member.id === prefillPaidBy)?.id ?? identityMemberId,
		});
		if (!prefill || appliedPrefillRef.current === prefillKey) return;
		appliedPrefillRef.current = prefillKey;
		const draft = readDraft<ExpenseDraft>(draftKey);
		if (draft && (draft.description || draft.amountStr || draft.imageUrl || draft.queueEditId)) {
			setPendingPrefill(prefill);
			setShowForm(true);
			return;
		}
		applyPrefill(prefill);
	}, [
		applyPrefill,
		draftKey,
		identityMemberId,
		members,
		prefillAmount,
		prefillDescription,
		prefillPaidBy,
		prefillKey,
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
		setDescription(template.description);
		setAmountStr(formatEuroInput(template.amountCents / CENTS_PER_EURO));
		setPaidByMemberId(template.paidByMemberId);
		setSplitMode('manual');
		setManualSplits(splitsToManualInput(template.splits));
		setQueueEditId(null);
		setQueueEditType(null);
		setEditingExpense(null);
		setInvalidEditDraft(false);
		setShowForm(true);
	}, [recurringExpenses, recurringId]);

	function resetForm(): void {
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

	function applyQuickExpense(template: (typeof QUICK_EXPENSE_TEMPLATES)[number]): void {
		setDescription(template.description.slice(0, DESCRIPTION_MAX));
		setAmountStr(template.amount);
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
		setShowForm(true);
		window.setTimeout(() => document.getElementById('f-beschreibung')?.focus(), 0);
	}

	function startEdit(expense: Expense): void {
		setDescription(expense.description);
		setAmountStr(formatEuroInput(expense.amountCents / CENTS_PER_EURO));
		setImageUrl(expense.imageUrl);
		setPaidByMemberId(expense.paidByMemberId);
		// Detect "equal" if the existing splits cover EVERY current member and
		// each share matches what Hamilton rounding would produce for the same
		// (amount, member-order) pair. Previous heuristic ("each split is base
		// or base+1") falsely treated [334,334,333] (3 cents remainder bug) and
		// expenses missing a member as equal.
		const isEqual = (() => {
			if (expense.splits.length === 0) return true;
			if (expense.splits.length !== members.length) return false;
			const expected = distributeCentsEqually(
				expense.amountCents,
				members.map((m) => m.id),
			);
			const byId = new Map(expense.splits.map((s) => [s.debtorMemberId, s.amountCents]));
			return members.every((m, idx) => byId.get(m.id) === expected[idx]);
		})();
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
		setEditingExpense({ id: expense.id, updatedAt: expense.updatedAt });
		setInvalidEditDraft(false);
		setShowForm(true);
	}

	function startRecurringEdit(template: RecurringExpense): void {
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
		// Intentionally read-only: `startEdit` is the only way into edit mode and
		// `resetForm` the only way out, so the two stay in sync with the rest of
		// the form state.
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
		acceptPendingPrefill: () => {
			if (pendingPrefill) applyPrefill(pendingPrefill);
		},
		resetForm,
		applyQuickExpense,
		startEdit,
		startRecurringEdit,
	};
}

/** Turns stored cent shares into the euro strings the manual inputs display. */
function splitsToManualInput(
	splits: ReadonlyArray<{ debtorMemberId: string; amountCents: number }>,
): Record<string, string> {
	return Object.fromEntries(
		splits.map((split) => [
			split.debtorMemberId,
			formatEuroInput(split.amountCents / CENTS_PER_EURO),
		]),
	);
}
