import {
	isAuthInvalidated,
	isInvalidShareCode,
	isNetworkError,
	isRetryableServerError,
	isWgUnavailable,
} from '@/core/errors/generic-error-codes';

interface WgLoadErrorOptions {
	verb?: 'konnte' | 'konnten';
}

export function getWgLoadErrorMessage(
	label: string,
	status: number,
	error: string | null,
	options: WgLoadErrorOptions = {},
): string {
	const prefix = `${label} ${options.verb ?? 'konnte'} nicht geladen werden`;
	if (isNetworkError(error, status)) {
		return `${prefix}: Prüfe deine Verbindung und versuche es erneut.`;
	}
	if (isWgUnavailable(error, status)) {
		return `${prefix}: Öffne die WG über den aktuellen Link erneut.`;
	}
	if (isInvalidShareCode(error)) {
		return `${prefix}: Der WG-Code ist ungültig.`;
	}
	if (isAuthInvalidated(error, status)) {
		return `${prefix}: Tritt der WG erneut bei.`;
	}
	if (error === 'query_invalid') {
		return `${prefix}: Der Suchbegriff ist zu lang.`;
	}
	if (isRetryableServerError(error, status)) {
		return `${prefix}: Versuche es gleich erneut.`;
	}
	return `${prefix}.`;
}
