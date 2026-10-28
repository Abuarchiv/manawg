import { mutationError } from '@/core/http/error-codes';
import type { Message, MessageKey } from '@/shared/i18n/message';

type ErrorKey = Extract<MessageKey, `expenses-debts.errors.${string}`>;

const SETTLE_SUBJECT: Message = { key: 'expenses-debts.errors.settleSubject' };
const CASH_SUBJECT: Message = { key: 'expenses-debts.errors.cashSubject' };
const VOID_SUBJECT: Message = { key: 'expenses-debts.errors.voidSubject' };

function detail(subject: Message, key: ErrorKey): Message {
	return { key: 'common.errors.withSubject', values: { subject, detail: { key } } };
}

function sentence(subject: Message): Message {
	return { key: 'expenses-debts.errors.sentence', values: { subject } };
}

const PAYMENT_NOT_FOUND: Message = { key: 'expenses-debts.errors.paymentNotFound' };
const PAYMENT_VOIDED: Message = { key: 'expenses-debts.errors.paymentVoided' };

const ERRORS: Record<string, Message> = {
	settlement_changed: { key: 'expenses-debts.errors.settlementChanged' },
	settlement_review_required: { key: 'expenses-debts.errors.reviewRequired' },
	member_not_in_wg: detail(SETTLE_SUBJECT, 'expenses-debts.errors.memberNotInWg'),
	not_party_to_debt: detail(SETTLE_SUBJECT, 'expenses-debts.errors.notPartyToDebt'),
	same_member: detail(SETTLE_SUBJECT, 'expenses-debts.errors.invalidRequest'),
	member_ids_invalid: detail(SETTLE_SUBJECT, 'expenses-debts.errors.invalidRequest'),
	invalid_json: detail(SETTLE_SUBJECT, 'expenses-debts.errors.invalidRequest'),
	invalid_body: detail(SETTLE_SUBJECT, 'expenses-debts.errors.invalidRequest'),
	amount_invalid: detail(CASH_SUBJECT, 'expenses-debts.errors.amountInvalid'),
	currency_invalid: detail(CASH_SUBJECT, 'expenses-debts.errors.amountInvalid'),
	payment_not_found: PAYMENT_NOT_FOUND,
	payment_voided: PAYMENT_VOIDED,
};

/** Copy for a failed manual settlement (`POST /expenses/settle-batch`). */
export function settlementError(error: string): Message {
	return mutationError(SETTLE_SUBJECT, error, ERRORS, sentence(SETTLE_SUBJECT));
}

const VOID_ERRORS: Record<string, Message> = {
	not_party_to_debt: detail(VOID_SUBJECT, 'expenses-debts.errors.notPartyToPayment'),
	payment_not_found: PAYMENT_NOT_FOUND,
	payment_voided: PAYMENT_VOIDED,
};

/** Copy for a failed void (`DELETE /payments/manual/[id]`). */
export function cashVoidError(error: string): Message {
	return mutationError(VOID_SUBJECT, error, VOID_ERRORS, sentence(VOID_SUBJECT));
}
