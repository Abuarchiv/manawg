import { type ApiErrorKind, classifyApiError } from '@/core/http/error-codes';
import type { Message, MessageKey } from '@/shared/i18n/message';

interface WgLoadErrorOptions {
	verb?: 'konnte' | 'konnten';
}

const LOAD_SUFFIX: Record<ApiErrorKind, string> = {
	network: ': Prüfe deine Verbindung und versuche es erneut.',
	wgUnavailable: ': Öffne die WG über den aktuellen Link erneut.',
	invalidShareCode: ': Der WG-Code ist ungültig.',
	readOnly: ': Die App ist gerade in Wartung. Versuche es später erneut.',
	sessionExpired: ': Melde dich neu an.',
	authInvalidated: ': Tritt der WG erneut bei.',
	retryable: ': Versuche es gleich erneut.',
};

export function getWgLoadErrorMessage(
	label: string,
	status: number,
	error: string | null,
	options: WgLoadErrorOptions = {},
): string {
	const prefix = `${label} ${options.verb ?? 'konnte'} nicht geladen werden`;
	const kind = classifyApiError(error, status);
	if (kind) return prefix + LOAD_SUFFIX[kind];
	if (error === 'query_invalid') return `${prefix}: Der Suchbegriff ist zu lang.`;
	return `${prefix}.`;
}

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
 * `getWgLoadErrorMessage` as data. `lead` is the whole clause naming what failed
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
