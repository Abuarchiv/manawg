import { todayInputValue } from '@/core/utils/local-date';
import type { ExpenseFormFieldErrors } from '@/features/expenses/components/ausgaben/ExpenseFormSection';
import {
	AMOUNT_MAX_EUROS,
	AMOUNT_MIN_EUROS,
	DESCRIPTION_MAX,
	amountErrorMessage,
} from '@/features/expenses/components/ausgaben/constants';

/** Field errors of description and amount, shared by the expense form and the fixed-cost template form. */
export function validateDescriptionAndAmount(input: {
	description: string;
	amountEuros: number | null;
	amountText: string;
}): ExpenseFormFieldErrors {
	const { description, amountEuros, amountText } = input;
	const errors: ExpenseFormFieldErrors = {};
	if (description.length === 0 || description.length > DESCRIPTION_MAX) {
		errors.description = 'Gib eine kurze Beschreibung ein.';
	}
	if (amountEuros === null || amountEuros < AMOUNT_MIN_EUROS || amountEuros > AMOUNT_MAX_EUROS) {
		errors.amount = amountErrorMessage(amountEuros, amountText);
	}
	return errors;
}

/** Field errors of the expense form's description, amount and date; empty when all are valid. */
export function validateExpenseFields(input: {
	description: string;
	amountEuros: number | null;
	amountText: string;
	occurredOn: string;
}): ExpenseFormFieldErrors {
	const errors = validateDescriptionAndAmount(input);
	if (input.occurredOn.length === 0 || input.occurredOn > todayInputValue()) {
		errors.date = 'Wähle ein Datum, das nicht in der Zukunft liegt.';
	}
	return errors;
}
