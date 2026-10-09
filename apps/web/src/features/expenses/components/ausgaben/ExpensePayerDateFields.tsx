import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { Member } from '@/components/wg/WgContextProvider';
import { berlinDayKey } from '@/core/utils/berlin-day';
import type { Dispatch, SetStateAction } from 'react';

interface ExpensePayerDateFieldsProps {
	occurredOn: string;
	setOccurredOn: Dispatch<SetStateAction<string>>;
	/** Fixed costs and queued expenses carry no date of their own. */
	showDate: boolean;
	paidByMemberId: string;
	setPaidByMemberId: Dispatch<SetStateAction<string>>;
	payerOptions: Member[];
	identityMemberId: string;
	isEditingExpense: boolean;
	disabled: boolean;
}

/** "Datum" and "Bezahlt von" of the expense form. */
export function ExpensePayerDateFields({
	occurredOn,
	setOccurredOn,
	showDate,
	paidByMemberId,
	setPaidByMemberId,
	payerOptions,
	identityMemberId,
	isEditingExpense,
	disabled,
}: ExpensePayerDateFieldsProps) {
	const todayKey = berlinDayKey(new Date());
	return (
		<>
			{showDate && (
				<Field data-disabled={disabled}>
					<FieldLabel htmlFor="expense-occurred-on">Datum</FieldLabel>
					<Input
						id="expense-occurred-on"
						type="date"
						value={occurredOn || todayKey}
						max={todayKey}
						// A cleared field means today; storing that day keeps what is shown and what is saved equal.
						onChange={(event) => setOccurredOn(event.target.value || todayKey)}
						disabled={disabled}
						className="text-base"
					/>
					<FieldDescription>Wann wurde bezahlt? Ohne Änderung gilt heute.</FieldDescription>
				</Field>
			)}
			<Field data-disabled={disabled}>
				<FieldLabel htmlFor="paid-by">Bezahlt von</FieldLabel>
				<NativeSelect
					id="paid-by"
					value={paidByMemberId}
					onChange={(event) => setPaidByMemberId(event.target.value)}
					disabled={disabled || isEditingExpense}
					className="w-full [&_select]:h-auto [&_select]:py-[0.5625rem] [&_select]:text-base"
				>
					{payerOptions.map((member) => (
						<NativeSelectOption key={member.id} value={member.id}>
							{member.name}
							{member.id === identityMemberId ? ' (du)' : ''}
						</NativeSelectOption>
					))}
				</NativeSelect>
				{isEditingExpense && (
					<FieldDescription>
						Die zahlende Person kann bei einer bestehenden Ausgabe nicht geändert werden.
					</FieldDescription>
				)}
			</Field>
		</>
	);
}
