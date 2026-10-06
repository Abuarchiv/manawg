import { useEffect, useRef } from 'react';
import type { SplitMode } from './useExpenseForm';

interface ExpenseFormDirtyInput {
	description: string;
	amountStr: string;
	paidByMemberId: string;
	splitMode: SplitMode;
	manualSplits: Record<string, string>;
	imageUrl: string | null;
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
	amountStr,
	paidByMemberId,
	splitMode,
	manualSplits,
	imageUrl,
	recurringIntervalMonths,
	identityMemberId,
	formModeKey,
	startsFromCurrentValues,
}: ExpenseFormDirtyInput): boolean {
	const formStateKey = JSON.stringify({
		description,
		amountStr,
		paidByMemberId,
		splitMode,
		manualSplits: Object.entries(manualSplits).sort(([left], [right]) => left.localeCompare(right)),
		imageUrl,
		recurringIntervalMonths,
	});
	const emptyFormStateKey = JSON.stringify({
		description: '',
		amountStr: '',
		paidByMemberId: identityMemberId,
		splitMode: 'equal',
		manualSplits: [],
		imageUrl: null,
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
