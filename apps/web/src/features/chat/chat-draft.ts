import { readDraft, writeDraft } from '@/core/offline/drafts';

/** What the composer keeps between visits: text and the message answered. */
export interface ChatDraft {
	body: string;
	replyToMessageId: string | null;
}

export function readChatDraft(draftKey: string, bodyMax: number): ChatDraft {
	const saved = readDraft<{ body?: string; replyToMessageId?: string }>(draftKey);
	return {
		body: typeof saved?.body === 'string' ? saved.body.slice(0, bodyMax) : '',
		replyToMessageId: typeof saved?.replyToMessageId === 'string' ? saved.replyToMessageId : null,
	};
}

/** Stores the draft; false when the browser refused it. */
export function writeChatDraft(draftKey: string, draft: ChatDraft): boolean {
	return writeDraft(draftKey, {
		body: draft.body,
		replyToMessageId: draft.replyToMessageId,
	});
}
