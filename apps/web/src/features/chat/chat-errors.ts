import { mutationError } from '@/core/http/error-codes';
import type { Message } from '@/shared/i18n/message';

import { EDIT_WINDOW_MS } from './chat-pure';

const DELETED_MESSAGE: Message = { key: 'chat.deleted' };

export type ChatAction = 'send' | 'react' | 'unreact' | 'edit' | 'delete';

/** The shared error buckets prefix their copy with this subject; the fallback is "<subject>.". */
const SUBJECTS: Record<ChatAction, Message> = {
	send: { key: 'chat.errors.sendSubject' },
	react: { key: 'chat.errors.reactSubject' },
	unreact: { key: 'chat.errors.reactSubject' },
	edit: { key: 'chat.errors.editSubject' },
	delete: { key: 'chat.errors.deleteSubject' },
};

const REPLY_GONE: Message = { key: 'chat.errors.replyGone' };

const CHAT_SPECIFIC_ERRORS: Readonly<Record<string, Message>> = {
	image_removed: { key: 'chat.errors.imageRemoved' },
	// Without these texts the reply preview would stay and every send would fail the same way, silently.
	reply_to_not_found: REPLY_GONE,
	reply_to_invalid: REPLY_GONE,
	message_deleted: DELETED_MESSAGE,
	edit_not_allowed: {
		key: 'chat.errors.editNotAllowed',
		values: { minutes: Math.round(EDIT_WINDOW_MS / 60_000) },
	},
};

/** The resident-facing message for a failed chat request. */
export function explainChatError(action: ChatAction, error: string): Message {
	const subject = SUBJECTS[action];
	return mutationError(subject, error, CHAT_SPECIFIC_ERRORS, {
		key: 'chat.errors.sentence',
		values: { subject },
	});
}
