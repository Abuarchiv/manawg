import { useToast } from '@/components/ui/Toast';
import { useWg } from '@/components/wg/WgContextProvider';
import { notifyChatReadConfirmed } from '@/components/wg/useWgCounts';
import { apiFetch } from '@/core/infra/api-client';
import {
	type NotificationWarning,
	notificationWarningMessage,
} from '@/core/notifications/notification-warning';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	CHAT_REFRESH_BATCH_SIZE,
	advanceChatRefreshSequence,
	isLatestChatRefreshResponse,
	mergePagedMessagesById,
	mergePagedReactions,
	nextChatRefreshBatch,
	reactionKeysToPreserve,
	reconcileChatMessages,
	reconcileChatReactions,
} from '../chat-pure';
import type { BubbleMessage, ReactionSummary } from '../components/MessageBubble';

export interface ChatMessageDto extends BubbleMessage {
	wgId: string;
	systemKind?: string | null;
	systemPayload?: Record<string, unknown> | null;
}

export interface ChatReactionRow {
	messageId: string;
	memberId: string;
	emoji: string;
}

const PAGE_SIZE = 50;
const CHAT_POLL_INTERVAL_MS = 8000;

type ChatAction = 'send' | 'react' | 'unreact' | 'edit' | 'delete';

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

function explainChatError(action: ChatAction, error: string): string {
	if (error === 'image_removed') {
		return 'Dieses Bild wurde entfernt. Lade es erneut hoch, bevor du die Nachricht sendest.';
	}
	if (error === 'too_many_requests') {
		return 'Zu viele Anfragen. Warte kurz und versuche es dann erneut.';
	}
	// Ohne diese Texte bliebe die Antwort-Vorschau stehen und jedes Senden scheiterte stumm gleich.
	if (error === 'reply_to_not_found' || error === 'reply_to_invalid') {
		return 'Die Nachricht, auf die du antwortest, gibt es nicht mehr. Entferne die Antwort und sende erneut.';
	}
	if (error === 'message_deleted') return 'Diese Nachricht wurde gelöscht.';
	if (error === 'edit_not_allowed') {
		return 'Nachrichten lassen sich nur 15 Minuten nach dem Senden bearbeiten.';
	}
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') return OFFLINE_ERRORS[action];
	return GENERIC_ERRORS[action];
}

function summarizeReactions(
	rows: ChatReactionRow[],
	currentMemberId: string,
): Map<string, ReactionSummary[]> {
	const byMessage = new Map<string, Map<string, { count: number; mine: boolean }>>();
	for (const row of rows) {
		const messageMap = byMessage.get(row.messageId) ?? new Map();
		const entry = messageMap.get(row.emoji) ?? { count: 0, mine: false };
		entry.count += 1;
		if (row.memberId === currentMemberId) entry.mine = true;
		messageMap.set(row.emoji, entry);
		byMessage.set(row.messageId, messageMap);
	}
	const result = new Map<string, ReactionSummary[]>();
	for (const [messageId, emojiMap] of byMessage) {
		const list: ReactionSummary[] = [];
		for (const [emoji, { count, mine }] of emojiMap) {
			list.push({ emoji, count, mine });
		}
		list.sort((a, b) => b.count - a.count);
		result.set(messageId, list);
	}
	return result;
}

/**
 * Nachrichten, Reaktionen und Lesestatus eines WG-Chats: Bootstrap, Polling/Realtime-Refresh,
 * Cursor-Pagination und alle Mutationen. Refresh-Antworten werden per Sequenznummer gegen
 * neuere lokale Änderungen abgesichert.
 */
export function useChatRoom({
	wgId,
	shareCode,
	initialMessages,
	initialReactions,
}: {
	wgId: string;
	shareCode: string;
	initialMessages: ChatMessageDto[];
	initialReactions: ChatReactionRow[];
}) {
	const { identity } = useWg();
	const toast = useToast();
	const encodedShareCode = encodeURIComponent(shareCode);
	const messagesUrl = `/api/wg/${encodedShareCode}/chat/messages`;

	const [messages, setMessages] = useState<ChatMessageDto[]>(initialMessages);
	const [reactionRows, setReactionRows] = useState<ChatReactionRow[]>(initialReactions);
	const [hasMoreOlder, setHasMoreOlder] = useState(initialMessages.length >= PAGE_SIZE);
	const [bootstrapping, setBootstrapping] = useState(initialMessages.length === 0);
	const [bootstrapError, setBootstrapError] = useState(false);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [olderError, setOlderError] = useState(false);
	const [refreshError, setRefreshError] = useState(false);
	const [readError, setReadError] = useState(false);
	const [sendError, setSendError] = useState<string | null>(null);
	const loadingOlderRef = useRef(false);
	const refreshOlderOffsetRef = useRef(0);
	const refreshRequestSequenceRef = useRef(0);
	const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
	const pendingMessageRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);
	const reactionRequestKeysRef = useRef(new Map<string, string>());
	const reactionMutationVersionsRef = useRef(
		new Map<string, { messageId: string; version: number }>(),
	);
	const pendingReactionMutationsRef = useRef(new Set<string>());
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const readSentinelRef = useRef<HTMLDivElement | null>(null);
	const lastReadSentIdRef = useRef<string | null>(null);

	const reactionsByMessage = useMemo(
		() => summarizeReactions(reactionRows, identity.memberId),
		[reactionRows, identity.memberId],
	);

	function invalidatePendingRefresh(): void {
		refreshRequestSequenceRef.current = advanceChatRefreshSequence(
			refreshRequestSequenceRef.current,
		);
	}

	const sendRead = useCallback(
		async (messageId: string | null) => {
			const res = await apiFetch(`/api/wg/${encodedShareCode}/chat/read`, {
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({ lastReadMessageId: messageId }),
			});
			// An older response must not overwrite a newer receipt's state.
			if (lastReadSentIdRef.current !== messageId) return;
			setReadError(!res.ok);
			if (!res.ok) lastReadSentIdRef.current = null;
			else notifyChatReadConfirmed(shareCode);
		},
		[encodedShareCode, identity.memberId, identity.memberToken, shareCode],
	);

	const markLatestRead = useCallback(() => {
		const latest = messages[messages.length - 1];
		if (!latest) return;
		if (lastReadSentIdRef.current === latest.id) return;
		lastReadSentIdRef.current = latest.id;
		void sendRead(latest.id);
	}, [messages, sendRead]);

	useEffect(() => {
		const root = scrollRef.current;
		const sentinel = readSentinelRef.current;
		if (!root || !sentinel || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) markLatestRead();
			},
			{ root, threshold: 1 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [markLatestRead]);

	const fetchMessages = useCallback(async (): Promise<boolean> => {
		const requestSequence = advanceChatRefreshSequence(refreshRequestSequenceRef.current);
		refreshRequestSequenceRef.current = requestSequence;
		const isLatest = () =>
			isLatestChatRefreshResponse(requestSequence, refreshRequestSequenceRef.current);
		const refreshBatch = nextChatRefreshBatch(
			messages,
			PAGE_SIZE,
			CHAT_REFRESH_BATCH_SIZE,
			refreshOlderOffsetRef.current,
		);
		refreshOlderOffsetRef.current = refreshBatch.nextOffset;
		const params = new URLSearchParams({ limit: `${PAGE_SIZE}` });
		for (const id of refreshBatch.ids) params.append('refreshId', id);
		const mutationVersionsAtRequest = new Map(
			[...reactionMutationVersionsRef.current].map(([key, mutation]) => [key, mutation.version]),
		);
		const res = await apiFetch<{
			messages: ChatMessageDto[];
			refreshedMessages?: ChatMessageDto[];
			reactions: ChatReactionRow[];
		}>(`${messagesUrl}?${params.toString()}`, { memberId: identity.memberId });
		if (!isLatest()) return true;
		if (!res.ok) {
			setRefreshError((prev) => (isLatest() ? true : prev));
			return false;
		}
		setRefreshError((prev) => (isLatest() ? false : prev));
		const refreshedLoadedMessages = res.data.refreshedMessages ?? [];
		const refreshedMessageIds = new Set(
			[...res.data.messages, ...refreshedLoadedMessages].map((message) => message.id),
		);
		setMessages((prev) =>
			isLatest()
				? reconcileChatMessages(prev, res.data.messages, refreshedLoadedMessages, PAGE_SIZE)
				: prev,
		);
		setReactionRows((prev) => {
			if (!isLatest()) return prev;
			const preservedLocalKeys = reactionKeysToPreserve(
				reactionMutationVersionsRef.current,
				pendingReactionMutationsRef.current,
				mutationVersionsAtRequest,
				refreshedMessageIds,
			);
			return reconcileChatReactions(
				prev,
				res.data.reactions,
				refreshedMessageIds,
				preservedLocalKeys,
			);
		});
		// Only ever grow: the latest page's length says nothing about whether
		// older pages were already loaded. loadOlder() clears the flag when the
		// history is exhausted.
		setHasMoreOlder((prev) => (isLatest() ? prev || res.data.messages.length >= PAGE_SIZE : prev));
		return true;
	}, [messagesUrl, identity.memberId, messages]);

	const refresh = useCallback((): Promise<boolean> => {
		// A poll must not supersede a request that is still loading. Mutations
		// still invalidate its sequence so a stale snapshot cannot undo them.
		refreshPromiseRef.current ??= fetchMessages().finally(() => {
			refreshPromiseRef.current = null;
		});
		return refreshPromiseRef.current;
	}, [fetchMessages]);

	useVisibilityPausedInterval(() => void refresh(), wgId ? CHAT_POLL_INTERVAL_MS : null);

	// Bootstrap through the gated API when the RSC passed no messages (the
	// server render intentionally loads none — see chat/page.tsx).
	const bootstrappedRef = useRef(initialMessages.length > 0);
	const loadInitialMessages = useCallback(async () => {
		setBootstrapError(false);
		setBootstrapping(true);
		const loaded = await refresh();
		setBootstrapError(!loaded);
		setBootstrapping(false);
	}, [refresh]);
	useEffect(() => {
		if (bootstrappedRef.current) return;
		bootstrappedRef.current = true;
		void loadInitialMessages();
	}, [loadInitialMessages]);

	async function loadOlder(): Promise<void> {
		if (loadingOlderRef.current || !hasMoreOlder) return;
		const oldest = messages[0];
		if (!oldest) return;
		loadingOlderRef.current = true;
		setOlderError(false);
		setLoadingOlder(true);
		try {
			const res = await apiFetch<{ messages: ChatMessageDto[]; reactions: ChatReactionRow[] }>(
				`${messagesUrl}?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.createdAt)}&beforeId=${encodeURIComponent(oldest.id)}`,
				{ memberId: identity.memberId },
			);
			if (!res.ok) {
				setOlderError(true);
				return;
			}
			if (res.data.messages.length === 0) {
				setHasMoreOlder(false);
				return;
			}
			setMessages((prev) => mergePagedMessagesById(res.data.messages, prev));
			setReactionRows((prev) => mergePagedReactions(res.data.reactions, prev));
			setHasMoreOlder(res.data.messages.length >= PAGE_SIZE);
		} finally {
			loadingOlderRef.current = false;
			setLoadingOlder(false);
		}
	}

	async function sendMessage(input: {
		body: string;
		mentionMemberIds: string[];
		replyToMessageId: string | null;
	}): Promise<boolean> {
		setSendError(null);
		const fingerprint = JSON.stringify(input);
		const pendingRequest = pendingMessageRequestRef.current;
		const idempotencyKey =
			pendingRequest?.fingerprint === fingerprint
				? pendingRequest.key
				: createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setSendError('Nachricht konnte nicht sicher gesendet werden. Versuche es erneut.');
			return false;
		}
		pendingMessageRequestRef.current = { fingerprint, key: idempotencyKey };
		const res = await apiFetch<{
			message: ChatMessageDto;
			warning: NotificationWarning;
		}>(messagesUrl, {
			method: 'POST',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			headers: { 'Idempotency-Key': idempotencyKey },
			body: JSON.stringify(input),
		});
		if (!res.ok) {
			if (res.status > 0 && res.status < 500) pendingMessageRequestRef.current = null;
			setSendError(explainChatError('send', res.error));
			return false;
		}
		pendingMessageRequestRef.current = null;
		invalidatePendingRefresh();
		setMessages((prev) =>
			prev.some((message) => message.id === res.data.message.id)
				? prev.map((message) => (message.id === res.data.message.id ? res.data.message : message))
				: [...prev, res.data.message],
		);
		void refresh();
		const warningMessage = notificationWarningMessage(res.data.warning, 'Gesendet');
		if (warningMessage) toast.info(warningMessage);
		return true;
	}

	/** Marks the reaction as in flight so a concurrent refresh keeps its local state. */
	async function mutateReaction(
		kind: 'add' | 'remove',
		messageId: string,
		emoji: string,
	): Promise<boolean> {
		const action = kind === 'add' ? 'react' : 'unreact';
		const requestKeyId = `${kind}:${messageId}:${emoji}`;
		const idempotencyKey =
			reactionRequestKeysRef.current.get(requestKeyId) ?? createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			toast.error(explainChatError(action, 'Netzwerkfehler'));
			return false;
		}
		reactionRequestKeysRef.current.set(requestKeyId, idempotencyKey);

		const mutationKey = `${messageId}|${identity.memberId}|${emoji}`;
		const current = reactionMutationVersionsRef.current.get(mutationKey);
		reactionMutationVersionsRef.current.set(mutationKey, {
			messageId,
			version: (current?.version ?? 0) + 1,
		});
		pendingReactionMutationsRef.current.add(mutationKey);
		let committed = false;
		try {
			const reactionsUrl = `/api/wg/${encodedShareCode}/chat/messages/${messageId}/reactions`;
			const res =
				kind === 'add'
					? await apiFetch(reactionsUrl, {
							method: 'POST',
							memberId: identity.memberId,
							memberToken: identity.memberToken,
							headers: { 'Idempotency-Key': idempotencyKey },
							body: JSON.stringify({ emoji }),
						})
					: await apiFetch(`${reactionsUrl}?emoji=${encodeURIComponent(emoji)}`, {
							method: 'DELETE',
							memberId: identity.memberId,
							memberToken: identity.memberToken,
							headers: { 'Idempotency-Key': idempotencyKey },
						});
			if (!res.ok) {
				if (res.status > 0 && res.status < 500) reactionRequestKeysRef.current.delete(requestKeyId);
				toast.error(explainChatError(action, res.error));
				return false;
			}
			committed = true;
			reactionRequestKeysRef.current.delete(requestKeyId);
			const isOwnRow = (row: ChatReactionRow) =>
				row.messageId === messageId && row.memberId === identity.memberId && row.emoji === emoji;
			setReactionRows((prev) =>
				kind === 'add'
					? prev.some(isOwnRow)
						? prev
						: [...prev, { messageId, memberId: identity.memberId, emoji }]
					: prev.filter((row) => !isOwnRow(row)),
			);
			return true;
		} finally {
			const latest = reactionMutationVersionsRef.current.get(mutationKey);
			if (committed && latest) {
				reactionMutationVersionsRef.current.set(mutationKey, {
					...latest,
					version: latest.version + 1,
				});
			}
			pendingReactionMutationsRef.current.delete(mutationKey);
		}
	}

	async function editMessage(messageId: string, next: string): Promise<boolean> {
		const res = await apiFetch<{ message: ChatMessageDto }>(`${messagesUrl}/${messageId}`, {
			method: 'PATCH',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify({ body: next }),
		});
		if (!res.ok) {
			toast.error(explainChatError('edit', res.error));
			return false;
		}
		invalidatePendingRefresh();
		setMessages((prev) =>
			prev.map((m) =>
				m.id === messageId
					? {
							...m,
							body: res.data.message.body,
							editedAt:
								typeof res.data.message.editedAt === 'string'
									? res.data.message.editedAt
									: new Date().toISOString(),
						}
					: m,
			),
		);
		return true;
	}

	async function deleteMessage(messageId: string): Promise<boolean> {
		const res = await apiFetch(`${messagesUrl}/${messageId}`, {
			method: 'DELETE',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
		});
		if (!res.ok) {
			toast.error(explainChatError('delete', res.error));
			return false;
		}
		invalidatePendingRefresh();
		setMessages((prev) =>
			prev.map((m) =>
				m.id === messageId
					? { ...m, body: null, imageUrl: null, deletedAt: new Date().toISOString() }
					: m,
			),
		);
		return true;
	}

	return {
		messages,
		reactionsByMessage,
		hasMoreOlder,
		bootstrapping,
		bootstrapError,
		loadingOlder,
		olderError,
		refreshError,
		readError,
		sendError,
		scrollRef,
		readSentinelRef,
		markLatestRead,
		refresh,
		loadInitialMessages,
		loadOlder,
		sendMessage,
		react: (messageId: string, emoji: string) => mutateReaction('add', messageId, emoji),
		unreact: (messageId: string, emoji: string) => mutateReaction('remove', messageId, emoji),
		editMessage,
		deleteMessage,
	};
}
