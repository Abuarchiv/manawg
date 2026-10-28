'use client';

import { useTranslations } from 'next-intl';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/features/expenses/expense-categories';

interface ExpenseCategoryFieldProps {
	id: string;
	value: ExpenseCategory;
	onChange: (value: ExpenseCategory) => void;
	disabled: boolean;
}

/** Category select shared by the expense and the fixed-cost forms. */
export function ExpenseCategoryField({ id, value, onChange, disabled }: ExpenseCategoryFieldProps) {
	const t = useTranslations('expenses-form.fields');
	const tCategories = useTranslations('expenses.categories');
	return (
		<Field data-disabled={disabled}>
			<FieldLabel htmlFor={id}>{t('category')}</FieldLabel>
			<NativeSelect
				id={id}
				value={value}
				onChange={(event) => {
					const next = EXPENSE_CATEGORIES.find((code) => code === event.target.value);
					if (next) onChange(next);
				}}
				disabled={disabled}
				className="w-full"
			>
				{EXPENSE_CATEGORIES.map((code) => (
					<NativeSelectOption key={code} value={code}>
						{tCategories(code)}
					</NativeSelectOption>
				))}
			</NativeSelect>
		</Field>
	);
}
