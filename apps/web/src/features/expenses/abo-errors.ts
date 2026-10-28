import { mutationError } from '@/core/http/error-codes';
import type { Message, MessageKey } from '@/shared/i18n/message';

type ErrorDetailKey = Extract<MessageKey, `expenses-abos.errors.${string}`>;

function detail(subject: Message, key: ErrorDetailKey): Message {
	return { key: 'common.errors.withSubject', values: { subject, detail: { key } } };
}

function withPeriod(subject: Message): Message {
	return { key: 'expenses-abos.errors.withPeriod', values: { subject } };
}

/**
 * Codes every recurring-expense call can answer with; the shared buckets (offline, 429, 503, 401)
 * come from `mutationError`. The server lets only the creator or a WG admin change recurring
 * expenses; everyone sees the buttons.
 */
function commonTexts(prefix: Message): Record<string, Message> {
	return {
		not_owner: detail(prefix, 'expenses-abos.errors.notOwner'),
		recurring_expense_not_found: { key: 'expenses-abos.errors.gone' },
		recurring_currency_unsupported: detail(prefix, 'expenses-abos.errors.euroOnly'),
		invalid_body: detail(prefix, 'expenses-abos.errors.invalidRequest'),
		invalid_json: detail(prefix, 'expenses-abos.errors.invalidRequest'),
	};
}

export function aboSaveError(error: string, action: 'created' | 'updated'): Message {
	const prefix: Message = {
		key:
			action === 'created'
				? 'expenses-abos.errors.saveCreated'
				: 'expenses-abos.errors.saveUpdated',
	};
	return mutationError(
		prefix,
		error,
		{
			...commonTexts(prefix),
			member_not_in_wg: detail(prefix, 'expenses-abos.errors.memberNotInWg'),
			recurring_expense_changed: detail(prefix, 'expenses-abos.errors.changedSave'),
			amount_invalid: detail(prefix, 'expenses-abos.errors.amountInvalid'),
			description_invalid: detail(prefix, 'expenses-abos.errors.descriptionInvalid'),
			interval_invalid: detail(prefix, 'expenses-abos.errors.intervalInvalid'),
			due_date_invalid: detail(prefix, 'expenses-abos.errors.dueDateInvalid'),
			splits_invalid: { key: 'expenses-abos.errors.splitsMismatch' },
			splits_sum_mismatch: { key: 'expenses-abos.errors.splitsMismatch' },
		},
		withPeriod(prefix),
	);
}

export function aboActionError(error: string): Message {
	const prefix: Message = { key: 'expenses-abos.errors.action' };
	return mutationError(
		prefix,
		error,
		{
			...commonTexts(prefix),
			recurring_expense_changed: detail(prefix, 'expenses-abos.errors.changedAction'),
		},
		{ key: 'expenses-abos.errors.actionFallback', values: { subject: prefix } },
	);
}

export function aboDeleteError(error: string): Message {
	const prefix: Message = { key: 'expenses-abos.errors.delete' };
	return mutationError(
		prefix,
		error,
		{
			...commonTexts(prefix),
			id_invalid: detail(prefix, 'expenses-abos.errors.idInvalid'),
			delete_failed: detail(prefix, 'expenses-abos.errors.deleteFailed'),
		},
		withPeriod(prefix),
	);
}
