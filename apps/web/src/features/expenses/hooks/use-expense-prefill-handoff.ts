'use client';

import { useEffect, useRef } from 'react';
import { parseExpenseCategory } from '@/features/expenses/expense-default-category';
import {
	type ExpenseSuggestion,
	recurringTemplateSuggestion,
} from '@/features/expenses/expense-form-draft';
import { buildExpensePrefillDraft } from '@/features/expenses/expense-prefill';
import type { RecurringExpense } from '@/features/expenses/expense-types';
import type { Locale } from '@/shared/i18n/locale';

/** The `desc`, `amount`, `paidBy` and `category` search params of a deep link into the form. */
export interface ExpensePrefillParams {
	description: string | null;
	amount: string | null;
	paidBy: string | null;
	category: string | null;
}

interface PrefillHandoffOptions {
	suggestPrefill: (prefill: ExpenseSuggestion) => void;
	members: ReadonlyArray<{ id: string }>;
	identityMemberId: string;
	prefill: ExpensePrefillParams;
	recurringId: string | null;
	recurringExpenses: readonly RecurringExpense[];
	locale: Locale;
}

/**
 * URL handoffs into the expense form (`?description=…` and `?recurring=<id>`). Each source
 * applies once per distinct URL so re-renders cannot overwrite the resident's edits.
 */
export function useExpensePrefillHandoff({
	suggestPrefill,
	members,
	identityMemberId,
	prefill: params,
	recurringId,
	recurringExpenses,
	locale,
}: PrefillHandoffOptions): void {
	const appliedPrefillRef = useRef<string | null>(null);
	const appliedRecurringRef = useRef<string | null>(null);
	const { description, amount, paidBy, category } = params;
	const prefillKey = `${description ?? ''}|${amount ?? ''}|${paidBy ?? ''}|${category ?? ''}`;

	// A handoff is a new draft, so it must not overwrite unfinished input.
	useEffect(() => {
		if (recurringId) return;
		const prefill = buildExpensePrefillDraft({
			description,
			amount,
			paidByMemberId: members.find((member) => member.id === paidBy)?.id ?? identityMemberId,
		});
		if (!prefill || appliedPrefillRef.current === prefillKey) return;
		appliedPrefillRef.current = prefillKey;
		// A category code that is not one of ours is ignored.
		const prefillCategory = parseExpenseCategory(category);
		suggestPrefill({
			...prefill,
			recurringSourceId: null,
			...(prefillCategory ? { category: prefillCategory } : {}),
		});
	}, [
		suggestPrefill,
		identityMemberId,
		members,
		description,
		amount,
		paidBy,
		category,
		prefillKey,
		recurringId,
	]);

	// `?recurring=<id>` turns a due fixed cost into a prefilled one-off expense. This creates a
	// NEW expense from the template, so it must not set `editingRecurringExpense`.
	useEffect(() => {
		if (!recurringId) return;
		if (appliedRecurringRef.current === recurringId) return;
		const template = recurringExpenses.find((item) => item.id === recurringId);
		if (!template) return;
		appliedRecurringRef.current = recurringId;
		suggestPrefill(recurringTemplateSuggestion(template, locale));
	}, [suggestPrefill, recurringExpenses, recurringId, locale]);
}
