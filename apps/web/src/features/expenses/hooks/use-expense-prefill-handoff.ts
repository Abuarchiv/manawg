'use client';

import { useEffect, useRef } from 'react';
import {
	type ExpenseSuggestion,
	recurringTemplateSuggestion,
} from '@/features/expenses/expense-form-draft';
import { buildExpensePrefillDraft } from '@/features/expenses/expense-prefill';
import type { RecurringExpense } from '@/features/expenses/expense-types';
import type { Locale } from '@/shared/i18n/locale';

interface PrefillHandoffOptions {
	suggestPrefill: (prefill: ExpenseSuggestion) => void;
	members: ReadonlyArray<{ id: string }>;
	identityMemberId: string;
	prefillDescription: string | null;
	prefillAmount: string | null;
	prefillPaidBy: string | null;
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
	prefillDescription,
	prefillAmount,
	prefillPaidBy,
	recurringId,
	recurringExpenses,
	locale,
}: PrefillHandoffOptions): void {
	const appliedPrefillRef = useRef<string | null>(null);
	const appliedRecurringRef = useRef<string | null>(null);
	const prefillKey = `${prefillDescription ?? ''}|${prefillAmount ?? ''}|${prefillPaidBy ?? ''}`;

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
