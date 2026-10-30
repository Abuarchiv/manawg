import { readDraft, writeDraft } from '@/core/offline/drafts';
import { isRecord } from '@/core/utils/is-record';
import type { PendingChatSendRequest } from './chat-send';

/** Storage key of the composer draft; `buildDraftKey` only covers the modules with a queue-edit route. */
export function chatDraftKey(shareCode: string, memberId: string): string {
	return `manawg:draft:${shareCode}:${memberId}:chat`;
}

export function chatEditDraftKey(shareCode: string, memberId: string, messageId: string): string {
	return `${chatDraftKey(shareCode, memberId)}:edit:${messageId}`;
}

/** What the composer keeps between visits: text, reply target and any uncertain send. */
export interface ChatDraft {
	body: string;
	replyToMessageId: string | null;
	pendingSend?: PendingChatSendRequest | null;
}

function parsePendingSend(value: unknown): PendingChatSendRequest | null {
	if (!isRecord(value) || typeof value.fingerprint !== 'string' || typeof value.key !== 'string') {
		return null;
	}
	return {
		fingerprint: value.fingerprint,
		key: value.key,
		createdAtMs:
			typeof value.createdAtMs === 'number' && Number.isFinite(value.createdAtMs)
				? value.createdAtMs
				: null,
	};
}

export function readChatDraft(draftKey: string, bodyMax: number): ChatDraft {
	const saved = readDraft<{ body?: string; replyToMessageId?: string; pendingSend?: unknown }>(
		draftKey,
	);
	return {
		body: typeof saved?.body === 'string' ? saved.body.slice(0, bodyMax) : '',
		replyToMessageId: typeof saved?.replyToMessageId === 'string' ? saved.replyToMessageId : null,
		pendingSend: parsePendingSend(saved?.pendingSend),
	};
}

/** Stores the draft; false when the browser refused it. */
export function writeChatDraft(draftKey: string, draft: ChatDraft): boolean {
	const pendingSend =
		draft.pendingSend === undefined
			? parsePendingSend(readDraft<{ pendingSend?: unknown }>(draftKey)?.pendingSend)
			: parsePendingSend(draft.pendingSend);
	return writeDraft(draftKey, {
		body: draft.body,
		replyToMessageId: draft.replyToMessageId,
		...(pendingSend ? { pendingSend } : {}),
	});
}
