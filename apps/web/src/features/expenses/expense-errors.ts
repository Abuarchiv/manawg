import { mutationError } from '@/core/http/error-codes';
import { DESCRIPTION_MAX_LENGTH } from '@/features/expenses/expense-constants';
import type { Message, MessageKey } from '@/shared/i18n/message';

/** Plain German text shared with recurring-errors.ts, which shows it as text. */
export const SPLIT_SUM_MISMATCH =
	// i18n-ignore plain German text for the fixed-cost form
	'Beträge stimmen nicht überein — Summe muss exakt dem Gesamtbetrag entsprechen.';

const msg = (key: MessageKey, values?: Message['values']): Message =>
	values ? { key, values } : { key };

/** "{subject}: {detail}" from two catalog keys. */
const withSubject = (
	subject: MessageKey,
	detail: MessageKey,
	values?: Message['values'],
): Message =>
	msg('common.errors.withSubject', { subject: msg(subject), detail: msg(detail, values) });

const withPeriod = (subject: MessageKey): Message =>
	msg('expenses-form.errors.withPeriod', { subject: msg(subject) });

const SPLIT_SUM = msg('expenses-form.errors.splitSumMismatch');
const PAID_BY_MUST_INCLUDE_CALLER = msg('expenses-form.errors.paidByMustIncludeCaller');
const NOT_TEMPLATE_OWNER = msg('expenses-form.errors.notTemplateOwner');
const RECURRING_NOT_FOUND = msg('expenses-form.errors.recurringNotFound');

const SAVE_SUBJECT = 'expenses-form.errors.save.subject';
const saveDetail = (key: MessageKey, values?: Message['values']) =>
	withSubject(SAVE_SUBJECT, key, values);
const SAVE_ERRORS: Record<string, Message> = {
	amount_invalid: saveDetail('expenses-form.errors.save.amountInvalid'),
	description_invalid: saveDetail('expenses-form.errors.save.descriptionInvalid', {
		max: DESCRIPTION_MAX_LENGTH,
	}),
	currency_invalid: saveDetail('expenses-form.errors.save.currencyInvalid'),
	image_invalid: saveDetail('expenses-form.errors.save.imageInvalid'),
	image_removed: saveDetail('expenses-form.errors.save.imageRemoved'),
	expected_updated_at_invalid: saveDetail('expenses-form.errors.save.expectedUpdatedAtInvalid'),
	occurred_at_invalid: saveDetail('expenses-form.errors.save.occurredAtInvalid'),
	splits_invalid: SPLIT_SUM,
	splits_sum_mismatch: SPLIT_SUM,
	splits_duplicate_debtor: msg('expenses-form.errors.save.splitsDuplicateDebtor'),
	paid_by_must_include_caller: PAID_BY_MUST_INCLUDE_CALLER,
	not_payer: msg('expenses-form.errors.save.notPayer'),
	expense_has_settled_shares: saveDetail('expenses-form.errors.save.hasSettledShares'),
	abo_paused: saveDetail('expenses-form.errors.save.aboPaused'),
	recurring_expense_already_advanced: msg('expenses-form.errors.save.recurringAdvanced'),
	recurring_expense_not_found: RECURRING_NOT_FOUND,
	member_not_in_wg: saveDetail('expenses-form.errors.save.memberNotInWg'),
	insert_failed: saveDetail('expenses-form.errors.save.insertFailed'),
	split_insert_failed: msg('expenses-form.errors.save.splitInsertFailed'),
	fetch_failed: msg('expenses-form.errors.save.fetchFailed'),
	invalid_body: saveDetail('expenses-form.errors.invalidRequest'),
	invalid_json: saveDetail('expenses-form.errors.invalidRequest'),
};

export function expenseSaveError(error: string): Message {
	return mutationError(msg(SAVE_SUBJECT), error, SAVE_ERRORS, withPeriod(SAVE_SUBJECT));
}

const ACTION_SUBJECT = msg('expenses.errors.actionSubject');
const ACTION_ERRORS: Record<string, Message> = {
	not_split_party: msg('expenses.errors.notSplitParty'),
	member_ids_invalid: msg('expenses.errors.memberIdsInvalid'),
	same_member: msg('expenses.errors.sameMember'),
	member_not_in_wg: msg('expenses.errors.memberNotInWg'),
	not_party_to_debt: msg('expenses.errors.notPartyToDebt'),
	invalid_body: msg('expenses.errors.changeInvalidRequest'),
	invalid_json: msg('expenses.errors.changeInvalidRequest'),
	id_invalid: msg('expenses.errors.idInvalid'),
	image_removed: msg('expenses.errors.imageRemoved'),
	settled_invalid: msg('expenses.errors.settledInvalid'),
	expense_has_settled_shares: msg('expenses.errors.hasSettledShares'),
	split_already_offset: msg('expenses.errors.splitAlreadyOffset'),
};

export function expenseActionError(error: string): Message {
	return mutationError(ACTION_SUBJECT, error, ACTION_ERRORS, msg('expenses.errors.actionFallback'));
}

const TEMPLATE_SAVE_SUBJECT = 'expenses-form.errors.template.subject';
const templateDetail = (key: MessageKey) => withSubject(TEMPLATE_SAVE_SUBJECT, key);
const TEMPLATE_SAVE_ERRORS: Record<string, Message> = {
	paid_by_must_include_caller: PAID_BY_MUST_INCLUDE_CALLER,
	not_owner: NOT_TEMPLATE_OWNER,
	member_not_in_wg: msg('expenses-form.errors.template.memberNotInWg'),
	recurring_expense_not_found: RECURRING_NOT_FOUND,
	insert_failed: templateDetail('expenses-form.errors.template.insertFailed'),
	update_failed: msg('expenses-form.errors.template.updateFailed'),
	amount_invalid: templateDetail('expenses-form.errors.template.amountInvalid'),
	description_invalid: templateDetail('expenses-form.errors.template.descriptionInvalid'),
	interval_invalid: templateDetail('expenses-form.errors.template.intervalInvalid'),
	due_date_invalid: templateDetail('expenses-form.errors.template.dueDateInvalid'),
	recurring_expense_changed: templateDetail('expenses-form.errors.template.changed'),
	splits_invalid: SPLIT_SUM,
	splits_sum_mismatch: SPLIT_SUM,
	invalid_body: templateDetail('expenses-form.errors.invalidRequest'),
	invalid_json: templateDetail('expenses-form.errors.invalidRequest'),
};

export function recurringTemplateSaveError(error: string): Message {
	return mutationError(
		msg(TEMPLATE_SAVE_SUBJECT),
		error,
		TEMPLATE_SAVE_ERRORS,
		withPeriod(TEMPLATE_SAVE_SUBJECT),
	);
}

const TEMPLATE_DELETE_SUBJECT = 'expenses-form.errors.templateDelete.subject';
const deleteDetail = (key: MessageKey) => withSubject(TEMPLATE_DELETE_SUBJECT, key);
const TEMPLATE_DELETE_ERRORS: Record<string, Message> = {
	not_owner: NOT_TEMPLATE_OWNER,
	id_invalid: deleteDetail('expenses-form.errors.templateDelete.idInvalid'),
	recurring_expense_not_found: RECURRING_NOT_FOUND,
	delete_failed: deleteDetail('expenses-form.errors.templateDelete.deleteFailed'),
	invalid_body: deleteDetail('expenses-form.errors.invalidRequest'),
	invalid_json: deleteDetail('expenses-form.errors.invalidRequest'),
};

export function recurringTemplateDeleteError(error: string): Message {
	return mutationError(
		msg(TEMPLATE_DELETE_SUBJECT),
		error,
		TEMPLATE_DELETE_ERRORS,
		withPeriod(TEMPLATE_DELETE_SUBJECT),
	);
}

export function recurringAdvanceWarning(status: number, error: string): Message {
	if (status === 409 && error === 'recurring_expense_already_advanced') {
		return msg('expenses-form.errors.advance.alreadyAdvanced');
	}
	if (error === 'update_failed') return msg('expenses-form.errors.advance.updateFailed');
	return msg('expenses-form.errors.advance.generic');
}

type SplitInputReason = 'invalid_share' | 'splits_empty' | 'splits_mismatch' | 'no_members';

/**
 * Why a form's split rows cannot be submitted, in the wording the expense form
 * shows. Keyed by the reasons `buildSplitsFromForm` reports.
 */
export function splitInputError(reason: SplitInputReason): Message {
	switch (reason) {
		case 'invalid_share':
			return msg('expenses-form.errors.split.invalidShare');
		case 'splits_empty':
			return msg('expenses-form.errors.split.empty');
		case 'splits_mismatch':
			return SPLIT_SUM;
		case 'no_members':
			return msg('expenses-form.errors.split.noMembers');
	}
}

/** Shown when the edited expense is gone on the server. */
export const EDITED_EXPENSE_DELETED = msg('expenses-form.errors.editedExpenseDeleted');
