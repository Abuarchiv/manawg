import {
	isNetworkError,
	isReadOnlyMode,
	isSessionExpired,
	mutationError,
} from '@/core/http/error-codes';
import {
	ABSENCE_REASON_MAX,
	CHORE_INTERVAL_MAX_DAYS,
	CHORE_INTERVAL_MAX_MONTHS,
	CHORE_INTERVAL_MIN,
	CHORE_TITLE_MAX,
	CHORE_TITLE_MIN,
} from '@/features/chores/chore-limits';
import type { Message } from '@/shared/i18n/message';

function withSubject(subject: Message, detail: Message): Message {
	return { key: 'common.errors.withSubject', values: { subject, detail } };
}

/** The subject as a sentence of its own, for errors without a detail. */
function sentence(subject: Message): Message {
	return { key: 'chores.errors.sentence', values: { subject } };
}

const MEMBER_NOT_IN_FLAT: Message = { key: 'chores.errors.memberNotInFlat' };
const CHECK_PLAN: Message = { key: 'chores.errors.checkPlan' };
const INVALID_REQUEST: Message = { key: 'chores.errors.invalidRequest' };
const DUE_DATE_INVALID: Message = { key: 'chores.errors.dueDateInvalid' };
const INTERVAL_INVALID: Message = {
	key: 'chores.errors.intervalInvalid',
	values: {
		min: CHORE_INTERVAL_MIN,
		maxDays: CHORE_INTERVAL_MAX_DAYS,
		maxMonths: CHORE_INTERVAL_MAX_MONTHS,
	},
};
const TITLE_INVALID: Message = {
	key: 'chores.errors.titleInvalid',
	values: { min: CHORE_TITLE_MIN, max: CHORE_TITLE_MAX },
};

const ABSENCE_SUBJECT: Message = { key: 'chores.errors.absenceSubject' };
const ABSENCE_ERRORS: Record<string, Message> = {
	date_range_invalid: withSubject(ABSENCE_SUBJECT, { key: 'chores.errors.dateRangeInvalid' }),
	absence_overlaps_existing: withSubject(ABSENCE_SUBJECT, { key: 'chores.errors.absenceOverlaps' }),
	not_owner: withSubject(ABSENCE_SUBJECT, { key: 'chores.errors.notOwner' }),
	reason_invalid: withSubject(ABSENCE_SUBJECT, {
		key: 'chores.errors.reasonInvalid',
		values: { max: ABSENCE_REASON_MAX },
	}),
	member_not_in_wg: withSubject(ABSENCE_SUBJECT, MEMBER_NOT_IN_FLAT),
	insert_failed: withSubject(ABSENCE_SUBJECT, CHECK_PLAN),
	invalid_json: withSubject(ABSENCE_SUBJECT, INVALID_REQUEST),
	invalid_body: withSubject(ABSENCE_SUBJECT, INVALID_REQUEST),
};

export function absenceSaveErrorMessage(error: string): Message {
	return mutationError(ABSENCE_SUBJECT, error, ABSENCE_ERRORS, sentence(ABSENCE_SUBJECT));
}

const CHORE_SUBJECT: Message = { key: 'chores.errors.createSubject' };
const CHORE_CREATE_ERRORS: Record<string, Message> = {
	member_not_in_wg: withSubject(CHORE_SUBJECT, MEMBER_NOT_IN_FLAT),
	interval_invalid: withSubject(CHORE_SUBJECT, INTERVAL_INVALID),
	title_invalid: withSubject(CHORE_SUBJECT, TITLE_INVALID),
	due_date_invalid: withSubject(CHORE_SUBJECT, DUE_DATE_INVALID),
	insert_failed: withSubject(CHORE_SUBJECT, CHECK_PLAN),
	invalid_body: withSubject(CHORE_SUBJECT, INVALID_REQUEST),
	invalid_json: withSubject(CHORE_SUBJECT, INVALID_REQUEST),
};

export function choreCreateErrorMessage(error: string): Message {
	return mutationError(CHORE_SUBJECT, error, CHORE_CREATE_ERRORS, {
		key: 'chores.errors.createFallback',
	});
}

/** Shared error texts for the swap and take-over actions: `subject` names what failed. */
export function choreActionErrorMessage(
	subject: Message,
	result: { error: string; status: number },
): Message {
	if (isReadOnlyMode(result.error)) return withSubject(subject, { key: 'common.errors.readOnly' });
	if (isSessionExpired(result.error)) {
		return withSubject(subject, { key: 'common.errors.sessionExpired' });
	}
	if (result.error === 'unexpected_error' || result.error === 'server_error') {
		return withSubject(subject, { key: 'common.errors.retry' });
	}
	if (isNetworkError(result.error, result.status)) {
		return withSubject(subject, { key: 'common.errors.network' });
	}
	return sentence(subject);
}

const EDIT_SUBJECT: Message = { key: 'chores.errors.editSubject' };
const CHORE_EDIT_ERRORS: Record<string, Message> = {
	title_invalid: withSubject(EDIT_SUBJECT, TITLE_INVALID),
	interval_invalid: withSubject(EDIT_SUBJECT, INTERVAL_INVALID),
	due_date_invalid: withSubject(EDIT_SUBJECT, DUE_DATE_INVALID),
	member_not_in_wg: withSubject(EDIT_SUBJECT, MEMBER_NOT_IN_FLAT),
	chore_changed: { key: 'chores.errors.choreChanged' },
	invalid_body: withSubject(EDIT_SUBJECT, INVALID_REQUEST),
	invalid_json: withSubject(EDIT_SUBJECT, INVALID_REQUEST),
};

export function choreEditErrorMessage(error: string): Message {
	return mutationError(EDIT_SUBJECT, error, CHORE_EDIT_ERRORS, sentence(EDIT_SUBJECT));
}
