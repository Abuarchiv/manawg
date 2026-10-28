import { mutationError } from '@/core/http/error-codes';
import type { Message } from '@/shared/i18n/message';
import { CONTENT_MAX } from './constants';

function withSubject(subject: Message, detail: Message): Message {
	return { key: 'common.errors.withSubject', values: { subject, detail } };
}

const REQUEST_INVALID: Message = { key: 'pinboard.errors.requestInvalid' };
const KIND_INVALID: Message = { key: 'pinboard.errors.kindInvalid' };
const CONTENT_INVALID: Message = {
	key: 'pinboard.errors.contentInvalid',
	values: { max: CONTENT_MAX },
};

const CREATE_SUBJECT: Message = { key: 'pinboard.errors.createSubject' };
const CREATE_ERRORS: Record<string, Message> = {
	content_invalid: withSubject(CREATE_SUBJECT, CONTENT_INVALID),
	kind_invalid: withSubject(CREATE_SUBJECT, KIND_INVALID),
	image_invalid: withSubject(CREATE_SUBJECT, { key: 'pinboard.errors.imageInvalid' }),
	image_removed: withSubject(CREATE_SUBJECT, { key: 'pinboard.errors.imageRemoved' }),
	source_path_invalid: withSubject(CREATE_SUBJECT, { key: 'pinboard.errors.sourcePathInvalid' }),
	insert_failed: withSubject(CREATE_SUBJECT, { key: 'pinboard.errors.insertFailed' }),
	invalid_json: withSubject(CREATE_SUBJECT, REQUEST_INVALID),
};

export function announcementCreateError(error: string): Message {
	return mutationError(CREATE_SUBJECT, error, CREATE_ERRORS, {
		key: 'pinboard.errors.sentence',
		values: { subject: CREATE_SUBJECT },
	});
}

const ACTION_SUBJECT: Message = { key: 'pinboard.errors.actionSubject' };
const ACTION_ERRORS: Record<string, Message> = {
	reaction_invalid: { key: 'pinboard.errors.reactionInvalid' },
	insert_failed: { key: 'pinboard.errors.reactionInsertFailed' },
	delete_failed: { key: 'pinboard.errors.reactionDeleteFailed' },
	reaction_not_found: { key: 'pinboard.errors.reactionNotFound' },
	status_invalid: { key: 'pinboard.errors.statusInvalid' },
	pinned_invalid: { key: 'pinboard.errors.pinnedInvalid' },
	kind_invalid: withSubject(ACTION_SUBJECT, KIND_INVALID),
	content_invalid: withSubject(ACTION_SUBJECT, CONTENT_INVALID),
	expected_state_invalid: withSubject(ACTION_SUBJECT, {
		key: 'pinboard.errors.expectedStateInvalid',
	}),
	announcement_changed: { key: 'pinboard.errors.announcementChanged' },
	content_locked: { key: 'pinboard.errors.contentLocked' },
	not_owner: withSubject(ACTION_SUBJECT, { key: 'pinboard.errors.notOwner' }),
	announcement_resolved: { key: 'pinboard.errors.announcementResolved' },
	status_change_not_allowed: { key: 'pinboard.errors.statusChangeNotAllowed' },
	invalid_body: withSubject(ACTION_SUBJECT, REQUEST_INVALID),
	invalid_json: withSubject(ACTION_SUBJECT, REQUEST_INVALID),
};

export function announcementActionError(error: string): Message {
	return mutationError(ACTION_SUBJECT, error, ACTION_ERRORS, {
		key: 'pinboard.errors.actionFallback',
		values: { subject: ACTION_SUBJECT },
	});
}
