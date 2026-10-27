import { todayInputValue } from '@/core/utils/local-date';
import type { SplitMode } from '@/features/expenses/expense-form-draft';
import { useEffect, useRef } from 'react';

interface ExpenseFormDirtyInput {
	description: string;
	category: string;
	amountStr: string;
	paidByMemberId: string;
	splitMode: SplitMode;
	manualSplits: Record<string, string>;
	imageUrl: string | null;
	occurredOn: string;
	participantIds: string[] | null;
	recurringIntervalMonths: number;
	identityMemberId: string;
	/** Which record the form edits; a new mode takes a new baseline. */
	formModeKey: string;
	/** Editing starts from the record's values, a new expense from the empty form. */
	startsFromCurrentValues: boolean;
}

/** Whether the form differs from what it started with, so closing it should ask first. */
export function useExpenseFormDirty({
	description,
	category,
	amountStr,
	paidByMemberId,
	splitMode,
	manualSplits,
	imageUrl,
	occurredOn,
	participantIds,
	recurringIntervalMonths,
	identityMemberId,
	formModeKey,
	startsFromCurrentValues,
}: ExpenseFormDirtyInput): boolean {
	const formStateKey = JSON.stringify({
		description,
		category,
		amountStr,
		paidByMemberId,
		splitMode,
		manualSplits: Object.entries(manualSplits).sort(([left], [right]) => left.localeCompare(right)),
		imageUrl,
		occurredOn,
		participantIds: participantIds ? [...participantIds].sort() : null,
		recurringIntervalMonths,
	});
	const emptyFormStateKey = JSON.stringify({
		description: '',
		category: 'sonstiges',
		amountStr: '',
		paidByMemberId: identityMemberId,
		splitMode: 'equal',
		manualSplits: [],
		imageUrl: null,
		occurredOn: todayInputValue(),
		participantIds: null,
		recurringIntervalMonths: 1,
	});
	const initialStateKey = startsFromCurrentValues ? formStateKey : emptyFormStateKey;
	const initialFormStateRef = useRef({ formModeKey, formStateKey: initialStateKey });

	useEffect(() => {
		if (initialFormStateRef.current.formModeKey === formModeKey) return;
		initialFormStateRef.current = { formModeKey, formStateKey: initialStateKey };
	}, [formModeKey, initialStateKey]);

	return initialFormStateRef.current.formStateKey !== formStateKey;
}
