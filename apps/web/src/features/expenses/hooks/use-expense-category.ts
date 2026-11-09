'use client';

import { useCallback, useRef, useState } from 'react';
import {
	DEFAULT_EXPENSE_CATEGORY,
	type ExpenseCategory,
} from '@/features/expenses/expense-categories';
import {
	parseExpenseCategory,
	resolveDefaultCategory,
} from '@/features/expenses/expense-default-category';
import type { Expense } from '@/features/expenses/expense-types';

/**
 * The category of the expense form. A new expense starts on the category of the member's last
 * expense with the same description, else on the last category saved in this flat, else "other".
 * Once the resident picks one (or a record or link names it), the default never replaces it.
 */
export function useExpenseCategory(
	memberId: string,
	expenses: readonly Pick<Expense, 'description' | 'category' | 'paidByMemberId'>[],
) {
	const [category, setCategoryState] = useState<ExpenseCategory>(DEFAULT_EXPENSE_CATEGORY);
	const [lastCategory, setLastCategory] = useState<ExpenseCategory | null>(null);
	const lastCategoryRef = useRef<ExpenseCategory | null>(null);
	const chosenRef = useRef(false);
	const expensesRef = useRef(expenses);
	expensesRef.current = expenses;

	const defaultFor = useCallback(
		(description: string): ExpenseCategory =>
			resolveDefaultCategory({
				description,
				expenses: expensesRef.current,
				memberId,
				lastCategory: lastCategoryRef.current,
			}),
		[memberId],
	);

	/** A category fixed by the resident, a link, or the record being edited. */
	const setCategory = useCallback((next: ExpenseCategory): void => {
		chosenRef.current = true;
		setCategoryState(next);
	}, []);

	/** A new expense is typed: follow the description until a category is picked. */
	const followDescription = useCallback(
		(description: string): void => {
			if (!chosenRef.current) setCategoryState(defaultFor(description));
		},
		[defaultFor],
	);
	/** A prefill without a category falls back to the default for its description. */
	const applyPrefill = useCallback(
		(description: string, prefilled: ExpenseCategory | undefined): void => {
			chosenRef.current = prefilled !== undefined;
			setCategoryState(prefilled ?? defaultFor(description));
		},
		[defaultFor],
	);
	const restore = useCallback((draft: { category?: unknown; lastCategory?: unknown }): void => {
		const last = parseExpenseCategory(draft.lastCategory);
		lastCategoryRef.current = last;
		setLastCategory(last);
		const stored = parseExpenseCategory(draft.category);
		if (!stored) return;
		setCategoryState(stored);
		chosenRef.current = stored !== (last ?? DEFAULT_EXPENSE_CATEGORY);
	}, []);
	const reset = useCallback((): void => {
		chosenRef.current = false;
		setCategoryState(lastCategoryRef.current ?? DEFAULT_EXPENSE_CATEGORY);
	}, []);
	/** After a save, so the next expense starts on the same category. */
	const remember = useCallback((next: ExpenseCategory): void => {
		lastCategoryRef.current = next;
		setLastCategory(next);
	}, []);

	return {
		category,
		setCategory,
		/** What an untouched form starts on, for telling it from a changed one. */
		emptyCategory: lastCategory ?? DEFAULT_EXPENSE_CATEGORY,
		lastCategory,
		followDescription,
		applyPrefill,
		restore,
		reset,
		remember,
	};
}
