import { type ApiErrorKind, classifyApiError } from '@/core/http/error-codes';
import type { Message, MessageKey } from '@/shared/i18n/message';

const LOAD_DETAIL: Record<ApiErrorKind, MessageKey> = {
	network: 'common.errors.network',
	wgUnavailable: 'common.errors.wgUnavailable',
	invalidShareCode: 'common.errors.invalidShareCode',
	readOnly: 'common.errors.maintenance',
	sessionExpired: 'common.errors.signInAgain',
	authInvalidated: 'common.errors.authInvalidated',
	retryable: 'common.errors.retry',
};

/**
 * `lead` is the whole clause naming what failed
 * ("Ausgaben konnten nicht geladen werden"), so no verb agreement happens here.
 */
export function wgLoadError(lead: Message, status: number, error: string | null): Message {
	const kind = classifyApiError(error, status);
	const detail = kind
		? LOAD_DETAIL[kind]
		: error === 'query_invalid'
			? 'common.errors.queryTooLong'
			: null;
	return detail
		? { key: 'common.errors.withSubject', values: { subject: lead, detail: { key: detail } } }
		: { key: 'common.loadError.withoutDetail', values: { lead } };
}
