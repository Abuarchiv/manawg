'use client';

import { Button } from '@/components/ui/button';
import { MessageGroup } from '@/components/ui/message';
import { MessageScrollerItem } from '@/components/ui/message-scroller';
import { Spinner } from '@/components/ui/spinner';
import { SYSTEM_MESSAGE_KIND } from '@/core/feed-kinds';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { chatEditDraftKey } from '../chat-draft';
import {
	type ChatReadMarker,
	chatDayLabel,
	countChatReaders,
	groupMessagesByDay,
} from '../chat-pure';
import { type BubbleMessage, MessageBubble, type ReactionSummary } from './MessageBubble';
import { SystemMessage } from './SystemMessage';

interface MessageListProps {
	messages: BubbleMessage[];
	members: { id: string; name: string; color: string | null }[];
	currentMemberId: string;
	shareCode: string;
	/** The divider "Neue Nachrichten" goes before this message. */
	firstUnreadId?: string | null;
	isAdmin: boolean;
	reactionsByMessage: Map<string, ReactionSummary[]>;
	reads: readonly ChatReadMarker[];
	/** Members whose read markers count for the read ticks: everyone active except the viewer. */
	readerIds: readonly string[];
	hasMoreOlder: boolean;
	loadingOlder: boolean;
	olderError: boolean;
	scrollRef: RefObject<HTMLDivElement | null>;
	onLoadOlder: () => void;
	onReact: (messageId: string, emoji: string) => Promise<string | null>;
	onUnreact: (messageId: string, emoji: string) => Promise<string | null>;
	onEdit: (messageId: string, next: string) => Promise<string | null>;
	onDelete: (messageId: string) => Promise<string | null>;
	onReply: (messageId: string) => void;
}
const NO_REACTIONS: ReactionSummary[] = [];
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

function groupsWithPreviousMessage(
	previous: BubbleMessage | undefined,
	current: BubbleMessage,
): boolean {
	const previousTime = previous ? Date.parse(previous.createdAt) : Number.NaN;
	const currentTime = Date.parse(current.createdAt);
	return Boolean(
		previous &&
			previous.kind !== SYSTEM_MESSAGE_KIND &&
			current.kind !== SYSTEM_MESSAGE_KIND &&
			previous.senderMemberId &&
			previous.senderMemberId === current.senderMemberId &&
			Number.isFinite(previousTime) &&
			Number.isFinite(currentTime) &&
			currentTime >= previousTime &&
			currentTime - previousTime <= MESSAGE_GROUP_WINDOW_MS,
	);
}

export function MessageList({
	messages,
	members,
	currentMemberId,
	shareCode,
	firstUnreadId = null,
	isAdmin,
	reactionsByMessage,
	reads,
	readerIds,
	hasMoreOlder,
	loadingOlder,
	olderError,
	scrollRef,
	onLoadOlder,
	onReact,
	onUnreact,
	onEdit,
	onDelete,
	onReply,
}: MessageListProps) {
	const topSentinelRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const sentinel = topSentinelRef.current;
		const root = scrollRef.current;
		if (
			!sentinel ||
			!root ||
			!hasMoreOlder ||
			loadingOlder ||
			olderError ||
			typeof IntersectionObserver === 'undefined'
		)
			return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) onLoadOlder();
			},
			{ root, threshold: 0.1 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [hasMoreOlder, loadingOlder, olderError, onLoadOlder, scrollRef]);

	const messagesById = useMemo(
		() => new Map(messages.map((message) => [message.id, message])),
		[messages],
	);
	const memberLookup = useMemo(
		() => new Map(members.map((member) => [member.id, member])),
		[members],
	);
	// A withdrawn system notice (e.g. its expense was deleted) leaves no trace,
	// unlike a deleted member message, which keeps its "gelöscht" bubble.
	const visibleMessages = useMemo(
		() => messages.filter((message) => !(message.kind === 'system' && message.deletedAt)),
		[messages],
	);
	const groups = useMemo(() => groupMessagesByDay(visibleMessages), [visibleMessages]);
	const oldestId = visibleMessages[0]?.id;
	const now = new Date();

	// Each message is a direct, stable child of MessageScrollerContent. Inserting
	// older messages moves the previous first item, which enables prepend restore.
	// scrollAnchor stays false: this is a live group chat, not an anchored AI turn.
	return groups.flatMap((group) =>
		group.messages.map((message, index) => {
			const grouped = groupsWithPreviousMessage(group.messages[index - 1], message);
			const sender = message.senderMemberId
				? (memberLookup.get(message.senderMemberId) ?? null)
				: null;
			const replyTo = message.replyToMessageId
				? (messagesById.get(message.replyToMessageId) ?? null)
				: null;
			const replyToSender = replyTo?.senderMemberId
				? (memberLookup.get(replyTo.senderMemberId) ?? null)
				: null;
			return (
				<MessageScrollerItem
					key={message.id}
					messageId={message.id}
					className={grouped ? '-mt-1.5' : undefined}
				>
					{message.id === oldestId && hasMoreOlder && (
						<div className="flex flex-col items-center gap-2 pb-3">
							<div ref={topSentinelRef} className="h-1" aria-hidden />
							{olderError && (
								<p role="alert" className="text-sm text-destructive">
									Ältere Nachrichten konnten nicht geladen werden.
								</p>
							)}
							<Button variant="ghost" disabled={loadingOlder} onClick={onLoadOlder}>
								{loadingOlder && <Spinner data-icon="inline-start" />}
								{loadingOlder
									? 'Ältere Nachrichten werden geladen…'
									: olderError
										? 'Erneut versuchen'
										: 'Ältere Nachrichten laden'}
							</Button>
						</div>
					)}
					{index === 0 && (
						<div className="flex justify-center py-2">
							<span
								data-slot="chat-day"
								className="max-w-full rounded-full bg-muted text-center [overflow-wrap:anywhere] px-3 py-1 text-xs font-medium text-muted-foreground"
							>
								{chatDayLabel(group.day, now)}
							</span>
						</div>
					)}
					{message.id === firstUnreadId && (
						<div className="flex justify-center py-2">
							<span
								data-slot="chat-unread"
								className="max-w-full rounded-full bg-muted text-center [overflow-wrap:anywhere] px-3 py-1 text-xs font-medium text-muted-foreground"
							>
								Neue Nachrichten
							</span>
						</div>
					)}
					{message.kind === SYSTEM_MESSAGE_KIND && !message.deletedAt ? (
						<SystemMessage
							shareCode={shareCode}
							systemKind={message.systemKind ?? null}
							payload={message.systemPayload ?? null}
						/>
					) : (
						<MessageGroup>
							<MessageBubble
								key={`${currentMemberId}:${message.id}`}
								message={message}
								sender={sender}
								currentMemberId={currentMemberId}
								grouped={grouped}
								isAdmin={isAdmin}
								isOwn={message.senderMemberId === currentMemberId}
								readCount={
									message.senderMemberId === currentMemberId
										? countChatReaders(message.createdAt, reads, readerIds)
										: 0
								}
								readTotal={readerIds.length}
								draftKey={chatEditDraftKey(shareCode, currentMemberId, message.id)}
								reactions={reactionsByMessage.get(message.id) ?? NO_REACTIONS}
								replyTo={replyTo}
								replyToSender={replyToSender}
								onReact={onReact}
								onUnreact={onUnreact}
								onEdit={onEdit}
								onDelete={onDelete}
								onReply={onReply}
							/>
						</MessageGroup>
					)}
				</MessageScrollerItem>
			);
		}),
	);
}
