const PUSH_ACTIVATION_ERROR_MESSAGES = new Set([
	'Push wird von diesem Browser nicht unterstützt.',
	'Push ist noch nicht konfiguriert.',
	'Benachrichtigungen wurden nicht erlaubt.',
	'Push-Abo konnte nicht gelesen werden.',
	'Push-Abo konnte nicht gespeichert werden.',
	'Push-Abo konnte nicht gespeichert werden: Aktiviere Web Push neu.',
	'Push-Abo konnte nicht gespeichert werden: Tritt der WG erneut bei.',
	'Push-Abo konnte nicht gespeichert werden: Versuche es gleich erneut.',
	'Push-Abo konnte nicht gespeichert werden: Dieser Browser ist mit einem anderen Konto verbunden. Versuche es erneut.',
]);

const PUSH_DEACTIVATION_ERROR_MESSAGES = new Set([
	'Push-Abo konnte nicht deaktiviert werden.',
	'Push-Abo konnte nicht deaktiviert werden: Tritt der WG erneut bei.',
	'Push-Abo konnte nicht deaktiviert werden: Versuche es gleich erneut.',
]);

export function formatPushActivationError(error: unknown): string {
	if (error instanceof Error && PUSH_ACTIVATION_ERROR_MESSAGES.has(error.message)) {
		return error.message;
	}
	if (error instanceof Error && error.name === 'NotAllowedError') {
		return 'Benachrichtigungen wurden nicht erlaubt.';
	}
	if (error instanceof Error && error.message.includes('Failed to register a ServiceWorker')) {
		return 'Web Push konnte nicht aktiviert werden: Lade die Seite neu und versuche es erneut.';
	}
	return 'Web Push konnte nicht aktiviert werden.';
}

export function formatPushDeactivationError(error: unknown): string {
	if (error instanceof Error && PUSH_DEACTIVATION_ERROR_MESSAGES.has(error.message)) {
		return error.message;
	}
	return 'Web Push konnte nicht deaktiviert werden.';
}

export function parseWebPushStatusCode(err: unknown): number {
	if (!err || typeof err !== 'object' || !('statusCode' in err)) return 0;
	const value = (err as { statusCode?: unknown }).statusCode;
	const statusCode =
		typeof value === 'number'
			? value
			: typeof value === 'string' && /^\d{3}$/.test(value)
				? Number(value)
				: 0;
	if (!Number.isInteger(statusCode)) return 0;
	return statusCode >= 100 && statusCode <= 599 ? statusCode : 0;
}

export function isTransientWebPushStatus(statusCode: number): boolean {
	return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

// Messages web-push throws locally (encryption-helper) when a stored subscription's own keys are
// unusable. VAPID (server key) errors never match these prefixes.
const INVALID_SUBSCRIPTION_KEY_MESSAGE =
	/^(The subscription (p256dh|auth key)\b|No user (public key|auth) provided)/;

/** A local web-push failure caused by the subscription's keys: it can never be delivered. */
export function isInvalidSubscriptionKeyError(err: unknown): boolean {
	return err instanceof Error && INVALID_SUBSCRIPTION_KEY_MESSAGE.test(err.message);
}
