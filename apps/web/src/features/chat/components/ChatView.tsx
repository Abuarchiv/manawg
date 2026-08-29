'use client';

import { useToast } from '@/components/ui/Toast';
import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { haptic } from '@/shared/lib/haptics';
import { ChevronDown, MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatChannel } from '../chat-channel';
import { mergePagedMessagesById, mergePagedReactions, previewBody } from '../chat-pure';
import { ChatComposer } from './ChatComposer';
import type { BubbleMessage, ReactionSummary } from './MessageBubble';
import { MessageList } from './MessageList';
import { TypingIndicator } from './TypingIndicator';

interface ChatMessageDto extends BubbleMessage {
	wgId: string;
	systemKind?: string | null;
	systemPayload?: Record<string, unknown> | null;
}

interface InitialReactionRow {
	messageId: string;
	memberId: string;
	emoji: string;
}

interface InitialMentionRow {
	messageId: string;
	mentionedMemberId: string;
}

interface ChatViewProps {
	wgId: string;
	shareCode: string;
	initialMessages: ChatMessageDto[];
	initialReactions: InitialReactionRow[];
	initialMentions: InitialMentionRow[];
}

const PAGE_SIZE = 50;

function summarizeReactions(
	rows: InitialReactionRow[],
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

function reactionRowKey(row: InitialReactionRow): string {
	return `${row.messageId}|${row.memberId}|${row.emoji}`;
}

export function ChatView({
	wgId,
	shareCode,
	initialMessages,
	initialReactions,
	initialMentions,
}: ChatViewProps) {
	const { members, identity, isAdmin } = useWg();
	const toast = useToast();
	const [messages, setMessages] = useState<ChatMessageDto[]>(initialMessages);
	const [reactionRows, setReactionRows] = useState<InitialReactionRow[]>(initialReactions);
	const [hasMoreOlder, setHasMoreOlder] = useState(initialMessages.length >= PAGE_SIZE);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [replyToId, setReplyToId] = useState<string | null>(null);
	// Boolean instead of a continuous offset: a numeric scroll state re-rendered
	// the whole list on every scroll frame.
	const [showJumpButton, setShowJumpButton] = useState(false);
	const nearBottomRef = useRef(true);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const readSentinelRef = useRef<HTMLDivElement | null>(null);
	const lastReadSentIdRef = useRef<string | null>(null);
	const encodedShareCode = encodeURIComponent(shareCode);
	void initialMentions;

	const reactionsByMessage = useMemo(
		() => summarizeReactions(reactionRows, identity.memberId),
		[reactionRows, identity.memberId],
	);

	function explainChatError(
		action: 'send' | 'react' | 'unreact' | 'edit' | 'delete',
		error: string,
	) {
		if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
			switch (action) {
				case 'send':
					return 'Nachricht konnte nicht gesendet werden: Prüfe deine Verbindung und versuche es erneut.';
				case 'react':
				case 'unreact':
					return 'Reaktion konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
				case 'edit':
					return 'Nachricht konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
				case 'delete':
					return 'Nachricht konnte nicht gelöscht werden: Prüfe deine Verbindung und versuche es erneut.';
			}
		}
		switch (action) {
			case 'send':
				return 'Nachricht konnte nicht gesendet werden.';
			case 'react':
			case 'unreact':
				return 'Reaktion konnte nicht gespeichert werden.';
			case 'edit':
				return 'Nachricht konnte nicht gespeichert werden.';
			case 'delete':
				return 'Nachricht konnte nicht gelöscht werden.';
		}
	}

	const sendRead = useCallback(
		async (messageId: string | null) => {
			await apiFetch(`/api/wg/${encodedShareCode}/chat/read`, {
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({ lastReadMessageId: messageId }),
			});
		},
		[encodedShareCode, identity.memberId, identity.memberToken],
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

	const refresh = useCallback(async () => {
		const res = await apiFetch<{ messages: ChatMessageDto[]; reactions: InitialReactionRow[] }>(
			`/api/wg/${encodedShareCode}/chat/messages?limit=${PAGE_SIZE}`,
			{ memberId: identity.memberId },
		);
		if (!res.ok) {
			toast.error('Chat konnte nicht aktualisiert werden.');
			return;
		}
		const refreshedMessageIds = new Set(res.data.messages.map((message) => message.id));
		setMessages((prev) => [
			...prev.filter((message) => !refreshedMessageIds.has(message.id)),
			...res.data.messages,
		]);
		setReactionRows((prev) => {
			const refreshedReactionKeys = new Set(res.data.reactions.map(reactionRowKey));
			const preservedLocalReactions = prev.filter(
				(reaction) =>
					refreshedMessageIds.has(reaction.messageId) &&
					reaction.memberId === identity.memberId &&
					!refreshedReactionKeys.has(reactionRowKey(reaction)),
			);
			return [
				...prev.filter((reaction) => !refreshedMessageIds.has(reaction.messageId)),
				...res.data.reactions,
				...preservedLocalReactions,
			];
		});
		// Only ever grow: the latest page's length says nothing about whether
		// older pages were already loaded. loadOlder() clears the flag when the
		// history is exhausted.
		setHasMoreOlder((prev) => prev || res.data.messages.length >= PAGE_SIZE);
	}, [encodedShareCode, identity.memberId, toast]);

	const { mode } = useChatChannel(wgId, {
		onMessageCreated: () => void refresh(),
		onMessageUpdated: () => void refresh(),
		onMessageDeleted: () => void refresh(),
		onReactionChanged: () => void refresh(),
	});

	// Bootstrap through the gated API when the RSC passed no messages (the
	// server render intentionally loads none — see chat/page.tsx).
	const bootstrappedRef = useRef(initialMessages.length > 0);
	useEffect(() => {
		if (bootstrappedRef.current) return;
		bootstrappedRef.current = true;
		void refresh();
	}, [refresh]);

	async function loadOlder(): Promise<void> {
		if (loadingOlder || !hasMoreOlder) return;
		const oldest = messages[0];
		if (!oldest) return;
		setLoadingOlder(true);
		try {
			const res = await apiFetch<{ messages: ChatMessageDto[]; reactions: InitialReactionRow[] }>(
				`/api/wg/${encodedShareCode}/chat/messages?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.createdAt)}&beforeId=${encodeURIComponent(oldest.id)}`,
				{ memberId: identity.memberId },
			);
			if (!res.ok) {
				toast.error('Ältere Nachrichten konnten nicht geladen werden.');
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
			setLoadingOlder(false);
		}
	}

	async function sendMessage(input: {
		body: string;
		mentionMemberIds: string[];
		replyToMessageId: string | null;
	}): Promise<boolean> {
		const res = await apiFetch<{ message: ChatMessageDto }>(
			`/api/wg/${encodedShareCode}/chat/messages`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify(input),
			},
		);
		if (!res.ok) {
			toast.error(explainChatError('send', res.error));
			return false;
		}
		setMessages((prev) =>
			prev.some((message) => message.id === res.data.message.id)
				? prev.map((message) => (message.id === res.data.message.id ? res.data.message : message))
				: [...prev, res.data.message],
		);
		void refresh();
		return true;
	}

	async function react(messageId: string, emoji: string): Promise<void> {
		const res = await apiFetch(`/api/wg/${encodedShareCode}/chat/messages/${messageId}/reactions`, {
			method: 'POST',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify({ emoji }),
		});
		if (!res.ok) {
			toast.error(explainChatError('react', res.error));
			return;
		}
		setReactionRows((prev) =>
			prev.some(
				(row) =>
					row.messageId === messageId && row.memberId === identity.memberId && row.emoji === emoji,
			)
				? prev
				: [...prev, { messageId, memberId: identity.memberId, emoji }],
		);
	}

	async function unreact(messageId: string, emoji: string): Promise<void> {
		const res = await apiFetch(
			`/api/wg/${encodedShareCode}/chat/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
			{ method: 'DELETE', memberId: identity.memberId, memberToken: identity.memberToken },
		);
		if (!res.ok) {
			toast.error(explainChatError('unreact', res.error));
			return;
		}
		setReactionRows((prev) =>
			prev.filter(
				(row) =>
					!(
						row.messageId === messageId &&
						row.memberId === identity.memberId &&
						row.emoji === emoji
					),
			),
		);
	}

	async function editMessage(messageId: string, next: string): Promise<void> {
		const res = await apiFetch<{ message: ChatMessageDto }>(
			`/api/wg/${encodedShareCode}/chat/messages/${messageId}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({ body: next }),
			},
		);
		if (!res.ok) {
			toast.error(explainChatError('edit', res.error));
			return;
		}
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
	}

	async function deleteMessage(messageId: string): Promise<void> {
		const res = await apiFetch(`/api/wg/${encodedShareCode}/chat/messages/${messageId}`, {
			method: 'DELETE',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
		});
		if (!res.ok) {
			toast.error(explainChatError('delete', res.error));
			return;
		}
		setMessages((prev) =>
			prev.map((m) =>
				m.id === messageId
					? { ...m, body: null, imageUrl: null, deletedAt: new Date().toISOString() }
					: m,
			),
		);
	}

	const replyTo = replyToId ? (messages.find((m) => m.id === replyToId) ?? null) : null;
	const replyToSender = replyTo?.senderMemberId
		? (members.find((m) => m.id === replyTo.senderMemberId) ?? null)
		: null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: messages.length is the trigger
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
	}, [messages.length]);

	// Initial mount: scroll after first paint so images/layout are measured
	useEffect(() => {
		requestAnimationFrame(() => {
			const el = scrollRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		});
	}, []);

	function onScroll(): void {
		const el = scrollRef.current;
		if (!el) return;
		const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		nearBottomRef.current = fromBottom <= 120;
		setShowJumpButton(!nearBottomRef.current);
	}

	function scrollToBottom(): void {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
		markLatestRead();
		haptic('selection');
	}

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div className="border-b border-[var(--border)] bg-[var(--bg-base)]">
				<div className="mx-auto flex w-full max-w-3xl items-center justify-between px-3 py-2 sm:px-4">
					<div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-1)]">
						Chat{' '}
						<span className="ml-1 inline-flex items-center gap-1 text-[11px] font-normal text-[var(--text-3)]">
							{mode === 'realtime' ? (
								<>
									<span
										className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
										aria-hidden
									/>
									live
								</>
							) : (
								<>
									<span
										className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--text-3)]"
										aria-hidden
									/>
									8s
								</>
							)}
						</span>
					</div>
				</div>
			</div>
			<div
				ref={scrollRef}
				onScroll={onScroll}
				data-scroll-y
				className="flex-1 overflow-y-auto bg-[var(--bg-base)] scroll-hide-mobile"
			>
				{messages.length === 0 && !hasMoreOlder ? (
					<div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-end px-3 pb-6 pt-6 sm:px-4">
						<div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)]/45 px-6 py-8 text-center">
							<MessageCircle className="h-8 w-8 text-[var(--text-3)]" aria-hidden />
							{/* craftsman-ignore: TS003 */}
							<p className="text-[13px] text-[var(--text-3)]">
								{'Noch keine Nachrichten. Schreibe die erste!'}
							</p>
						</div>
					</div>
				) : (
					<MessageList
						messages={messages}
						members={members.map((m) => ({ id: m.id, name: m.name, color: m.color ?? null }))}
						currentMemberId={identity.memberId}
						isAdmin={isAdmin}
						reactionsByMessage={reactionsByMessage}
						hasMoreOlder={hasMoreOlder}
						loadingOlder={loadingOlder}
						onLoadOlder={() => void loadOlder()}
						onReact={(id, emoji) => void react(id, emoji)}
						onUnreact={(id, emoji) => void unreact(id, emoji)}
						onEdit={editMessage}
						onDelete={deleteMessage}
						onReply={(id) => setReplyToId(id)}
					/>
				)}
				<div ref={readSentinelRef} className="h-px" aria-hidden />
			</div>
			<TypingIndicator names={[]} />
			{showJumpButton && (
				<button
					type="button"
					onClick={scrollToBottom}
					aria-label="Zum Ende scrollen"
					className="absolute bottom-24 right-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<ChevronDown className="h-4 w-4" aria-hidden />
				</button>
			)}
			<ChatComposer
				members={members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name }))}
				currentMemberId={identity.memberId}
				replyToMessageId={replyToId}
				replyToPreview={
					replyTo ? previewBody(replyTo.body ?? (replyTo.imageUrl ? 'Bild' : ''), 80) : null
				}
				replyToSenderName={replyToSender?.name ?? null}
				onClearReply={() => setReplyToId(null)}
				onSend={sendMessage}
				onPickImage={() => undefined}
			/>
		</div>
	);
}
