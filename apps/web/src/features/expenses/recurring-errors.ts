import { mutationError } from '@/core/http/error-codes';
import type { Message, MessageKey } from '@/shared/i18n/message';

type ErrorDetailKey = Extract<MessageKey, `expenses-recurring.errors.${string}`>;

function detail(subject: Message, key: ErrorDetailKey): Message {
	return { key: 'common.errors.withSubject', values: { subject, detail: { key } } };
}

function withPeriod(subject: Message): Message {
	return { key: 'expenses-recurring.errors.withPeriod', values: { subject } };
}

/**
 * Codes every recurring-expense call can answer with; the shared buckets (offline, 429, 503, 401)
 * come from `mutationError`. The server lets only the creator or a WG admin change recurring
 * expenses; everyone sees the buttons.
 */
function commonTexts(prefix: Message): Record<string, Message> {
	return {
		not_owner: detail(prefix, 'expenses-recurring.errors.notOwner'),
		recurring_expense_not_found: { key: 'expenses-recurring.errors.gone' },
		recurring_currency_unsupported: detail(prefix, 'expenses-recurring.errors.euroOnly'),
		invalid_body: detail(prefix, 'expenses-recurring.errors.invalidRequest'),
		invalid_json: detail(prefix, 'expenses-recurring.errors.invalidRequest'),
	};
}

export function recurringSaveError(error: string, action: 'created' | 'updated'): Message {
	const prefix: Message = {
		key:
			action === 'created'
				? 'expenses-recurring.errors.saveCreated'
				: 'expenses-recurring.errors.saveUpdated',
	};
	return mutationError(
		prefix,
		error,
		{
			...commonTexts(prefix),
			member_not_in_wg: detail(prefix, 'expenses-recurring.errors.memberNotInWg'),
			recurring_expense_changed: detail(prefix, 'expenses-recurring.errors.changedSave'),
			amount_invalid: detail(prefix, 'expenses-recurring.errors.amountInvalid'),
			description_invalid: detail(prefix, 'expenses-recurring.errors.descriptionInvalid'),
			interval_invalid: detail(prefix, 'expenses-recurring.errors.intervalInvalid'),
			due_date_invalid: detail(prefix, 'expenses-recurring.errors.dueDateInvalid'),
			splits_invalid: { key: 'expenses-recurring.errors.splitsMismatch' },
			splits_sum_mismatch: { key: 'expenses-recurring.errors.splitsMismatch' },
		},
		withPeriod(prefix),
	);
}

export function recurringActionError(error: string): Message {
	const prefix: Message = { key: 'expenses-recurring.errors.action' };
	return mutationError(
		prefix,
		error,
		{
			...commonTexts(prefix),
			recurring_expense_changed: detail(prefix, 'expenses-recurring.errors.changedAction'),
		},
		{ key: 'expenses-recurring.errors.actionFallback', values: { subject: prefix } },
	);
}

export function recurringDeleteError(error: string): Message {
	const prefix: Message = { key: 'expenses-recurring.errors.delete' };
	return mutationError(
		prefix,
		error,
		{
			...commonTexts(prefix),
			id_invalid: detail(prefix, 'expenses-recurring.errors.idInvalid'),
			delete_failed: detail(prefix, 'expenses-recurring.errors.deleteFailed'),
		},
		withPeriod(prefix),
	);
}
