'use client';

import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
	EXPENSE_CATEGORIES,
	EXPENSE_CATEGORY_LABELS,
	type ExpenseCategory,
} from '@/features/expenses/expense-categories';

interface ExpenseCategoryFieldProps {
	id: string;
	value: ExpenseCategory;
	onChange: (value: ExpenseCategory) => void;
	disabled: boolean;
}

/** "Kategorie" select shared by the expense and the fixed-cost forms. */
export function ExpenseCategoryField({ id, value, onChange, disabled }: ExpenseCategoryFieldProps) {
	return (
		<Field data-disabled={disabled}>
			<FieldLabel htmlFor={id}>Kategorie</FieldLabel>
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
						{EXPENSE_CATEGORY_LABELS[code]}
					</NativeSelectOption>
				))}
			</NativeSelect>
		</Field>
	);
}
