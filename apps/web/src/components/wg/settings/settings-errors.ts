import type { AuthFailure } from '@/core/auth/password-errors';
import { type ApiErrorKind, classifyApiError } from '@/core/http/error-codes';
import type { Message, MessageKey } from '@/shared/i18n/message';

type KindDetails = Partial<Record<ApiErrorKind, MessageKey>>;

/** `{subject}: {detail}` as one message, the shape every settings failure uses. */
export function subjectError(subject: MessageKey, detail: MessageKey): Message {
	return {
		key: 'common.errors.withSubject',
		values: { subject: { key: subject }, detail: { key: detail } },
	};
}

function messageFor(
	details: KindDetails,
	subject: MessageKey,
	fallback: MessageKey,
	status: number,
	code: string | null,
): Message {
	const kind = classifyApiError(code, status);
	const detail = kind && details[kind];
	return detail ? subjectError(subject, detail) : { key: fallback };
}

// On a dropped connection the request may or may not have reached the server,
// so the copy must not claim the flat still exists.
export function deleteWgErrorMessage(status: number, code: string | null): Message {
	const kind = classifyApiError(code, status);
	switch (kind) {
		case 'network':
			return { key: 'settings.dangerZone.errors.network' };
		case 'wgUnavailable':
			return { key: 'settings.dangerZone.errors.notFound' };
		case 'invalidShareCode':
			return { key: 'settings.dangerZone.errors.invalidCode' };
		case 'retryable':
			return subjectError('settings.dangerZone.errors.subject', 'common.errors.retry');
		case 'authInvalidated':
			return { key: 'settings.dangerZone.errors.membershipInvalid' };
		default:
			return { key: 'settings.dangerZone.errors.fallback' };
	}
}

const NOTIFICATION_SAVE_DETAILS: Record<ApiErrorKind, MessageKey> = {
	network: 'common.errors.network',
	retryable: 'common.errors.retry',
	// withWgRoute -> readShareCode rejects a malformed code before the body is
	// even parsed, so this route really can answer `invalid_share_code`.
	wgUnavailable: 'common.errors.wgUnavailable',
	invalidShareCode: 'common.errors.wgUnavailable',
	authInvalidated: 'common.errors.authInvalidated',
	readOnly: 'common.errors.readOnly',
	sessionExpired: 'common.errors.sessionExpired',
};

const SAVE_SUBJECT = 'settings.notifications.errors.saveSubject';

export function notificationSaveErrorMessage(status: number, code: string | null): Message {
	if (code === 'insert_failed') return subjectError(SAVE_SUBJECT, 'common.errors.retry');
	if (code === 'member_not_found') {
		return subjectError(SAVE_SUBJECT, 'common.errors.authInvalidated');
	}
	const kind = classifyApiError(code, status);
	if (kind) return subjectError(SAVE_SUBJECT, NOTIFICATION_SAVE_DETAILS[kind]);
	if (code === 'quiet_hours_invalid') {
		return subjectError(
			'settings.notifications.errors.quietSubject',
			'settings.notifications.errors.quietInvalid',
		);
	}
	if (code === 'invalid_body' || code === 'invalid_json') {
		return subjectError(SAVE_SUBJECT, 'settings.notifications.errors.invalidRequest');
	}
	return { key: 'settings.notifications.errors.saveFallback' };
}

const SENDING_DETAILS: KindDetails = {
	network: 'common.errors.network',
	retryable: 'common.errors.retry',
	wgUnavailable: 'common.errors.wgUnavailable',
	invalidShareCode: 'common.errors.invalidShareCode',
	authInvalidated: 'common.errors.authInvalidated',
};

export function notificationTestErrorMessage(status: number, code: string | null): Message {
	if (code === 'no_push_subscription') {
		return { key: 'settings.notifications.errors.noSubscription' };
	}
	return messageFor(
		SENDING_DETAILS,
		'settings.notifications.errors.testSubject',
		'settings.notifications.errors.testFallback',
		status,
		code,
	);
}

export function exportErrorMessage(status: number, code: string | null): Message {
	if (code === 'section_invalid') {
		return subjectError('settings.data.errors.subject', 'settings.data.errors.invalidSection');
	}
	return messageFor(
		SENDING_DETAILS,
		'settings.data.errors.subject',
		'settings.data.errors.fallback',
		status,
		code,
	);
}

const AUTH_FAILURE_KEYS: Record<Exclude<AuthFailure, 'other'>, MessageKey> = {
	credentials: 'settings.authFailure.credentials',
	unconfirmed: 'settings.authFailure.unconfirmed',
	'rate-limit': 'settings.authFailure.rateLimit',
	network: 'settings.authFailure.network',
};

/** The sign-in service failure as a message; `other` is the row's own text. */
export function authFailureMessage(failure: AuthFailure, other: MessageKey): Message {
	return { key: failure === 'other' ? other : AUTH_FAILURE_KEYS[failure] };
}
