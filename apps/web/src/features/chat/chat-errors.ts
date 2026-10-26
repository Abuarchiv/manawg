import {
	RATE_LIMITED_MESSAGE,
	READ_ONLY_MESSAGE,
	SESSION_EXPIRED_MESSAGE,
	isRateLimited,
	isReadOnlyMode,
	isRetryableServerError,
	isSessionExpired,
} from '@/core/http/error-codes';

import { EDIT_WINDOW_MS } from './chat-pure';

export const DELETED_MESSAGE_TEXT = 'Diese Nachricht wurde gelöscht.';

export type ChatAction = 'send' | 'react' | 'unreact' | 'edit' | 'delete';

const OFFLINE_ERRORS: Record<ChatAction, string> = {
	send: 'Nachricht konnte nicht gesendet werden: Prüfe deine Verbindung und versuche es erneut.',
	react: 'Reaktion konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
	unreact:
		'Reaktion konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
	edit: 'Nachricht konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
	delete: 'Nachricht konnte nicht gelöscht werden: Prüfe deine Verbindung und versuche es erneut.',
};

const GENERIC_ERRORS: Record<ChatAction, string> = {
	send: 'Nachricht konnte nicht gesendet werden.',
	react: 'Reaktion konnte nicht gespeichert werden.',
	unreact: 'Reaktion konnte nicht gespeichert werden.',
	edit: 'Nachricht konnte nicht gespeichert werden.',
	delete: 'Nachricht konnte nicht gelöscht werden.',
};

/** The resident-facing message for a failed chat request. */
export function explainChatError(action: ChatAction, error: string): string {
	if (error === 'image_removed') {
		return 'Dieses Bild wurde entfernt. Lade es erneut hoch, bevor du die Nachricht sendest.';
	}
	// The middleware answers 429 with `rate_limited`, the routes with `too_many_requests`.
	if (isRateLimited(error)) return RATE_LIMITED_MESSAGE;
	// Without these texts the reply preview would stay and every send would fail the same way, silently.
	if (error === 'reply_to_not_found' || error === 'reply_to_invalid') {
		return 'Die Nachricht, auf die du antwortest, gibt es nicht mehr. Entferne die Antwort und sende erneut.';
	}
	if (error === 'message_deleted') return DELETED_MESSAGE_TEXT;
	if (error === 'edit_not_allowed') {
		return `Nachrichten lassen sich nur ${Math.round(EDIT_WINDOW_MS / 60_000)} Minuten nach dem Senden bearbeiten.`;
	}
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') return OFFLINE_ERRORS[action];
	if (isReadOnlyMode(error)) return READ_ONLY_MESSAGE;
	if (isSessionExpired(error)) return SESSION_EXPIRED_MESSAGE;
	if (isRetryableServerError(error)) return `${GENERIC_ERRORS[action]} Versuche es gleich erneut.`;
	return GENERIC_ERRORS[action];
}
