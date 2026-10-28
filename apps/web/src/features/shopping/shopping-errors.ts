import { isNetworkError, isRetryableServerError, mutationError } from '@/core/http/error-codes';
import { NAME_MAX, QUANTITY_MAX } from '@/features/shopping/components/constants';
import type { Message } from '@/shared/i18n/message';

function withSubject(subject: Message, detail: Message): Message {
	return { key: 'common.errors.withSubject', values: { subject, detail } };
}

const NAME_INVALID: Message = { key: 'shopping.errors.nameInvalid', values: { max: NAME_MAX } };
const QUANTITY_INVALID: Message = {
	key: 'shopping.errors.quantityInvalid',
	values: { max: QUANTITY_MAX },
};
const STATUS_INVALID: Message = { key: 'shopping.errors.statusInvalid' };
const REQUEST_INVALID: Message = { key: 'shopping.errors.requestInvalid' };

const ADD_SUBJECT: Message = { key: 'shopping.errors.addSubject' };

export function shoppingAddError(error: string): Message {
	return mutationError(
		ADD_SUBJECT,
		error,
		{
			name_invalid: withSubject(ADD_SUBJECT, NAME_INVALID),
			quantity_invalid: withSubject(ADD_SUBJECT, QUANTITY_INVALID),
			bought_invalid: withSubject(ADD_SUBJECT, STATUS_INVALID),
			invalid_json: withSubject(ADD_SUBJECT, REQUEST_INVALID),
			invalid_body: withSubject(ADD_SUBJECT, REQUEST_INVALID),
			insert_failed: withSubject(ADD_SUBJECT, { key: 'shopping.errors.insertFailed' }),
		},
		{ key: 'shopping.errors.addFallback' },
	);
}

/** Short and named, so it is clear which row is meant. */
export function shoppingDuplicateError(name: string, withQuantityHint = false): Message {
	return {
		key: withQuantityHint ? 'shopping.errors.duplicateWithQuantity' : 'shopping.errors.duplicate',
		values: { name },
	};
}

export type ShoppingActionVerb = 'checked' | 'reopened' | 'removed' | 'changed';

const ACTION_SUBJECT_KEYS = {
	checked: 'shopping.errors.subjectChecked',
	reopened: 'shopping.errors.subjectReopened',
	removed: 'shopping.errors.subjectRemoved',
	changed: 'shopping.errors.subjectChanged',
} as const satisfies Record<ShoppingActionVerb, Message['key']>;

/** Names item and action so the text does not read like an add error. */
export function shoppingActionError(
	error: string,
	itemName: string,
	verb: ShoppingActionVerb,
): Message {
	const subject: Message = { key: ACTION_SUBJECT_KEYS[verb], values: { name: itemName } };
	return mutationError(
		subject,
		error,
		{
			invalid_body: withSubject(subject, REQUEST_INVALID),
			invalid_json: withSubject(subject, REQUEST_INVALID),
			bought_invalid: withSubject(subject, STATUS_INVALID),
			name_invalid: withSubject(subject, NAME_INVALID),
			quantity_invalid: withSubject(subject, QUANTITY_INVALID),
			id_invalid: { key: 'shopping.errors.idInvalid' },
		},
		{ key: 'shopping.errors.actionFallback', values: { subject } },
	);
}

const CLEAR_SUBJECT: Message = { key: 'shopping.errors.clearSubject' };

export function clearBoughtError(status: number, error: string): Message {
	if (status === 403 || error === 'not_admin') return { key: 'shopping.errors.clearNotAdmin' };
	if (isNetworkError(error, status)) {
		return withSubject(CLEAR_SUBJECT, { key: 'common.errors.network' });
	}
	if (isRetryableServerError(error, status)) {
		return withSubject(CLEAR_SUBJECT, { key: 'common.errors.retry' });
	}
	return { key: 'shopping.errors.sentence', values: { subject: CLEAR_SUBJECT } };
}
