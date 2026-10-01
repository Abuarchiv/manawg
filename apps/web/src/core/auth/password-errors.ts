export const WEAK_PASSWORD_MESSAGE =
	'Wähle ein längeres oder anderes sicheres Passwort, das du nicht schon an anderer Stelle verwendest.';

export type AuthFailure = 'credentials' | 'unconfirmed' | 'rate-limit' | 'network' | 'other';

const RATE_LIMIT_CODES = new Set([
	'over_request_rate_limit',
	'over_email_send_rate_limit',
	'over_sms_send_rate_limit',
]);

/** Map a Supabase Auth error to the cases that need their own German message. */
export function classifyAuthError(error: unknown): AuthFailure {
	if (error === null || typeof error !== 'object') return 'other';
	const code = Reflect.get(error, 'code');
	const status = Reflect.get(error, 'status');
	if (status === 429 || (typeof code === 'string' && RATE_LIMIT_CODES.has(code))) {
		return 'rate-limit';
	}
	if (code === 'invalid_credentials') return 'credentials';
	if (code === 'email_not_confirmed') return 'unconfirmed';
	if (Reflect.get(error, 'name') === 'AuthRetryableFetchError') return 'network';
	return 'other';
}

export const AUTH_FAILURE_MESSAGES: Record<Exclude<AuthFailure, 'other'>, string> = {
	credentials:
		'E-Mail oder Passwort stimmt nicht. Prüfe deine Eingabe oder setze dein Passwort zurück.',
	unconfirmed:
		'Deine E-Mail-Adresse ist noch nicht bestätigt. Öffne den Link in der Bestätigungsmail und melde dich danach an.',
	'rate-limit': 'Zu viele Versuche. Bitte warte einige Minuten und versuche es dann erneut.',
	network: 'Keine Verbindung zum Anmeldedienst. Prüfe deine Verbindung und versuche es erneut.',
};

export function isWeakPasswordError(error: unknown): boolean {
	return (
		error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'weak_password'
	);
}
