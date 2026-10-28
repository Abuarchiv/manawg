'use client';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { Member } from '@/components/wg/WgContextProvider';
import { todayInputValue } from '@/core/utils/local-date';
import { useTranslations } from 'next-intl';
import type { Dispatch, SetStateAction } from 'react';

interface ExpensePayerDateFieldsProps {
	paidByMemberId: string;
	setPaidByMemberId: Dispatch<SetStateAction<string>>;
	payerOptions: Member[];
	identityMemberId: string;
	isEditingExpense: boolean;
	occurredOn: string;
	setOccurredOn: (value: string) => void;
	dateError: string | undefined;
	onClearDateError: () => void;
	formSaving: boolean;
}

/** Date and payer fields: who paid and on which day. */
export function ExpensePayerDateFields({
	paidByMemberId,
	setPaidByMemberId,
	payerOptions,
	identityMemberId,
	isEditingExpense,
	occurredOn,
	setOccurredOn,
	dateError,
	onClearDateError,
	formSaving,
}: ExpensePayerDateFieldsProps) {
	const t = useTranslations('expenses-form.fields');
	return (
		<>
			<Field data-disabled={formSaving} data-invalid={Boolean(dateError)}>
				<FieldLabel htmlFor="expense-date">{t('date')}</FieldLabel>
				<Input
					id="expense-date"
					type="date"
					value={occurredOn}
					max={todayInputValue()}
					onChange={(event) => {
						setOccurredOn(event.target.value);
						onClearDateError();
					}}
					disabled={formSaving}
					required
					aria-invalid={Boolean(dateError)}
					aria-describedby={dateError ? 'expense-date-error' : undefined}
					className="text-base"
				/>
				<FieldError id="expense-date-error">{dateError}</FieldError>
			</Field>
			<Field data-disabled={formSaving}>
				<FieldLabel htmlFor="paid-by">{t('paidBy')}</FieldLabel>
				<NativeSelect
					id="paid-by"
					value={paidByMemberId}
					onChange={(event) => setPaidByMemberId(event.target.value)}
					disabled={formSaving || isEditingExpense}
					className="w-full"
				>
					{payerOptions.map((member) => (
						<NativeSelectOption key={member.id} value={member.id}>
							{member.id === identityMemberId ? t('payerYou', { name: member.name }) : member.name}
						</NativeSelectOption>
					))}
				</NativeSelect>
				{isEditingExpense && <FieldDescription>{t('payerLocked')}</FieldDescription>}
			</Field>
		</>
	);
}
