import { INVALID_RESPONSE_CODE } from '@/core/http/error-codes';
import {
	createIdempotencyKey,
	isIdempotencyKey,
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import type { NotificationWarning } from '@/core/notifications/notification-warning';
import {
	OFFLINE_REPLAY_CLOCK_SKEW_MS,
	OFFLINE_REPLAY_MAX_AGE_MS,
} from '@/core/offline/replay-retention';
import { isRecord } from '@/core/utils/is-record';
import type { ChatMessageDto } from './chat-types';

export interface ChatMessageInput {
	body: string;
	mentionMemberIds: string[];
	replyToMessageId: string | null;
}

/** The key of a send whose outcome is unknown; a retry of the same input reuses it. */
export interface PendingChatSend {
	current: PendingChatSendRequest | null;
}

export interface PendingChatSendRequest extends PendingIdempotentRequest {
	/** The first send time; retries must stay inside the server's response-replay window. */
	createdAtMs: number | null;
}

export type PersistPendingChatSend = (pending: PendingChatSendRequest | null) => boolean;

export type ChatSendResult =
	| { ok: true; message: ChatMessageDto; warning: NotificationWarning }
	| { ok: false; reason: 'key_unavailable' }
	| { ok: false; reason: 'replay_expired' }
	| { ok: false; reason: 'rejected'; error: string };

interface ChatSendDeps {
	messagesUrl: string;
	memberId: string;
	pending: PendingChatSend;
	persistPending: PersistPendingChatSend;
	createKey?: () => string | null;
}

function isChatMessage(value: unknown): value is ChatMessageDto {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		value.id.trim().length > 0 &&
		typeof value.wgId === 'string' &&
		(value.senderMemberId === null || typeof value.senderMemberId === 'string') &&
		typeof value.kind === 'string' &&
		(value.body === null || typeof value.body === 'string') &&
		(value.imageUrl === null || typeof value.imageUrl === 'string') &&
		typeof value.createdAt === 'string' &&
		Number.isFinite(Date.parse(value.createdAt)) &&
		(value.editedAt === null || typeof value.editedAt === 'string') &&
		(value.deletedAt === null || typeof value.deletedAt === 'string') &&
		(value.replyToMessageId === null || typeof value.replyToMessageId === 'string')
	);
}

function pendingChatSendIsReplaySafe(pending: PendingChatSendRequest, now = Date.now()): boolean {
	const createdAt = pending.createdAtMs;
	return (
		isIdempotencyKey(pending.key) &&
		typeof createdAt === 'number' &&
		Number.isFinite(createdAt) &&
		createdAt <= now + OFFLINE_REPLAY_CLOCK_SKEW_MS &&
		now - Math.min(createdAt, now) < OFFLINE_REPLAY_MAX_AGE_MS
	);
}

/**
 * Posts a chat message under an idempotency key. A response that never arrived (status 0) or a
 * server error keeps the key, so sending the same text again cannot create a second message.
 */
export async function postChatMessage(
	input: ChatMessageInput,
	{
		messagesUrl,
		memberId,
		pending,
		persistPending,
		createKey = createIdempotencyKey,
	}: ChatSendDeps,
): Promise<ChatSendResult> {
	const fingerprint = JSON.stringify(input);
	if (
		pending.current?.fingerprint === fingerprint &&
		(!isIdempotencyKey(pending.current.key) || !pendingChatSendIsReplaySafe(pending.current))
	) {
		return { ok: false, reason: 'replay_expired' };
	}
	const idempotencyKey = resolveIdempotencyKey(pending.current, fingerprint, createKey);
	if (!isIdempotencyKey(idempotencyKey)) return { ok: false, reason: 'key_unavailable' };
	const pendingRequest: PendingChatSendRequest = {
		fingerprint,
		key: idempotencyKey,
		createdAtMs:
			pending.current?.fingerprint === fingerprint ? pending.current.createdAtMs : Date.now(),
	};
	if (!persistPending(pendingRequest)) {
		return { ok: false, reason: 'key_unavailable' };
	}
	pending.current = pendingRequest;
	const res = await apiFetch<{ message: ChatMessageDto; warning: NotificationWarning }>(
		messagesUrl,
		{
			method: 'POST',
			memberId,
			headers: { 'Idempotency-Key': idempotencyKey },
			body: JSON.stringify(input),
		},
	);
	if (!res.ok) {
		if (shouldReleaseIdempotencyKey(res.status, res.error)) {
			pending.current = null;
			persistPending(null);
		}
		return { ok: false, reason: 'rejected', error: res.error };
	}
	if (!isRecord(res.data) || !isChatMessage(res.data.message)) {
		return { ok: false, reason: 'rejected', error: INVALID_RESPONSE_CODE };
	}
	pending.current = null;
	persistPending(null);
	return { ok: true, message: res.data.message, warning: res.data.warning };
}
