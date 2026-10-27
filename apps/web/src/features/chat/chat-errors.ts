import { mutationErrorMessage } from '@/core/http/error-codes';

import { EDIT_WINDOW_MS } from './chat-pure';

export const DELETED_MESSAGE_TEXT = 'Diese Nachricht wurde gelöscht.';

export type ChatAction = 'send' | 'react' | 'unreact' | 'edit' | 'delete';

/** The shared error buckets prefix their copy with this subject; the fallback is "<subject>.". */
const SUBJECTS: Record<ChatAction, string> = {
	send: 'Nachricht konnte nicht gesendet werden',
	react: 'Reaktion konnte nicht gespeichert werden',
	unreact: 'Reaktion konnte nicht gespeichert werden',
	edit: 'Nachricht konnte nicht gespeichert werden',
	delete: 'Nachricht konnte nicht gelöscht werden',
};

const CHAT_SPECIFIC_ERRORS: Readonly<Record<string, string>> = {
	image_removed: 'Dieses Bild wurde entfernt. Lade es erneut hoch, bevor du die Nachricht sendest.',
	// Without these texts the reply preview would stay and every send would fail the same way, silently.
	reply_to_not_found:
		'Die Nachricht, auf die du antwortest, gibt es nicht mehr. Entferne die Antwort und sende erneut.',
	reply_to_invalid:
		'Die Nachricht, auf die du antwortest, gibt es nicht mehr. Entferne die Antwort und sende erneut.',
	message_deleted: DELETED_MESSAGE_TEXT,
	edit_not_allowed: `Nachrichten lassen sich nur ${Math.round(EDIT_WINDOW_MS / 60_000)} Minuten nach dem Senden bearbeiten.`,
};

/** The resident-facing message for a failed chat request. */
export function explainChatError(action: ChatAction, error: string): string {
	const subject = SUBJECTS[action];
	return mutationErrorMessage(subject, error, CHAT_SPECIFIC_ERRORS, `${subject}.`);
}
