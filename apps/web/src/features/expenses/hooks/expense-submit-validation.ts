import { todayInputValue } from '@/core/utils/local-date';
import { MS_PER_DAY } from '@/core/utils/time';
import {
	AMOUNT_MAX_EUROS,
	AMOUNT_MIN_EUROS,
	amountError,
	DESCRIPTION_MAX_LENGTH,
	EXPENSE_MAX_AGE_DAYS,
} from '@/features/expenses/expense-constants';
import type { ExpenseFormFieldErrors } from '@/features/expenses/expense-types';

/** Field errors of description and amount, shared by the expense form and the fixed-cost template form. */
export function validateDescriptionAndAmount(input: {
	description: string;
	amountEuros: number | null;
	amountText: string;
}): ExpenseFormFieldErrors {
	const { description, amountEuros, amountText } = input;
	const errors: ExpenseFormFieldErrors = {};
	if (description.length === 0 || description.length > DESCRIPTION_MAX_LENGTH) {
		errors.description = { key: 'expenses-form.validation.description' };
	}
	if (amountEuros === null || amountEuros < AMOUNT_MIN_EUROS || amountEuros > AMOUNT_MAX_EUROS) {
		errors.amount = amountError(amountEuros, amountText);
	}
	return errors;
}

/**
 * Earliest day a newly picked expense date may have. One day inside the server's bound, so a day
 * the form accepts is never refused for its age.
 */
export function oldestExpenseDay(now = new Date()): string {
	return todayInputValue(new Date(now.getTime() - (EXPENSE_MAX_AGE_DAYS - 1) * MS_PER_DAY));
}

/**
 * Field errors of the expense form's description, amount and date; empty when all are valid.
 * `keptDay` is the stored day of an edited expense: the server keeps it unchanged, so it may be
 * older than the bound for new dates.
 */
export function validateExpenseFields(
	input: {
		description: string;
		amountEuros: number | null;
		amountText: string;
		occurredOn: string;
	},
	keptDay: string | null = null,
	now = new Date(),
): ExpenseFormFieldErrors {
	const errors = validateDescriptionAndAmount(input);
	const day = input.occurredOn;
	const tooOld = day !== keptDay && day < oldestExpenseDay(now);
	if (day.length === 0 || day > todayInputValue(now) || tooOld) {
		errors.date = { key: 'expenses-form.validation.date' };
	}
	return errors;
}
