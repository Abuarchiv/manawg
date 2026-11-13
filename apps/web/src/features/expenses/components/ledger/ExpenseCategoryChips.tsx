'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { toggleVariants } from '@/components/ui/toggle';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/features/expenses/expense-categories';
import { cn } from '@/shared/lib/cn';

interface ExpenseCategoryChipsProps {
	value: ExpenseCategory;
	onChange: (value: ExpenseCategory) => void;
	disabled: boolean;
}

/**
 * Single-choice category chips of the expense form (the fixed-cost form keeps the select).
 * Native radio inputs give the radiogroup semantics and arrow-key navigation.
 */
export function ExpenseCategoryChips({ value, onChange, disabled }: ExpenseCategoryChipsProps) {
	const t = useTranslations('expenses-form.fields');
	const tCategories = useTranslations('expenses.categories');
	const name = useId();
	return (
		<FieldSet disabled={disabled}>
			<FieldLegend variant="label">{t('category')}</FieldLegend>
			<div role="radiogroup" aria-label={t('category')} className="flex flex-wrap gap-x-2 gap-y-3">
				{EXPENSE_CATEGORIES.map((code) => (
					<label
						key={code}
						className={cn(
							toggleVariants({ variant: 'outline', size: 'sm' }),
							'cursor-pointer select-none has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-checked:hover:bg-foreground/90 has-checked:hover:text-background has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring has-disabled:cursor-default has-disabled:opacity-50',
						)}
					>
						<input
							type="radio"
							name={name}
							value={code}
							checked={code === value}
							onChange={() => onChange(code)}
							// Tapping the selected chip fires no change event, but it still is a choice.
							onClick={() => onChange(code)}
							className="sr-only"
						/>
						{tCategories(code)}
					</label>
				))}
			</div>
		</FieldSet>
	);
}
