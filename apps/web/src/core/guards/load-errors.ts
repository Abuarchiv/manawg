import { type ApiErrorKind, classifyApiError } from '@/core/http/error-codes';

interface WgLoadErrorOptions {
	verb?: 'konnte' | 'konnten';
}

const LOAD_SUFFIX: Record<ApiErrorKind, string> = {
	network: ': Prüfe deine Verbindung und versuche es erneut.',
	wgUnavailable: ': Öffne die WG über den aktuellen Link erneut.',
	invalidShareCode: ': Der WG-Code ist ungültig.',
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
