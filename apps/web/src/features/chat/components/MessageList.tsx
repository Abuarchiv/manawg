'use client';

import { Button } from '@/components/ui/button';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { MessageGroup } from '@/components/ui/message';
import { MessageScrollerItem } from '@/components/ui/message-scroller';
import { Spinner } from '@/components/ui/spinner';
import { type RefObject, useEffect, useRef } from 'react';
import { groupMessagesByDay } from '../chat-pure';
import { type BubbleMessage, MessageBubble, type ReactionSummary } from './MessageBubble';
import { SystemMessage } from './SystemMessage';

interface MessageListProps {
	messages: BubbleMessage[];
	members: { id: string; name: string; color: string | null }[];
	currentMemberId: string;
	shareCode: string;
	isAdmin: boolean;
	reactionsByMessage: Map<string, ReactionSummary[]>;
	hasMoreOlder: boolean;
	loadingOlder: boolean;
	olderError: boolean;
	scrollRef: RefObject<HTMLDivElement | null>;
	onLoadOlder: () => void;
	onReact: (messageId: string, emoji: string) => Promise<boolean>;
	onUnreact: (messageId: string, emoji: string) => Promise<boolean>;
	onEdit: (messageId: string, next: string) => Promise<boolean>;
	onDelete: (messageId: string) => Promise<boolean>;
	onReply: (messageId: string) => void;
}
const DAY_FORMAT = new Intl.DateTimeFormat('de-DE', {
	weekday: 'long',
	day: '2-digit',
	month: 'long',
});

export function MessageList({
	messages,
	members,
	currentMemberId,
	shareCode,
	isAdmin,
	reactionsByMessage,
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

	const messagesById = new Map(messages.map((message) => [message.id, message]));
	const memberLookup = new Map(members.map((member) => [member.id, member]));
	const groups = groupMessagesByDay(messages);
	const oldestId = messages[0]?.id;

	// Each message is a direct, stable child of MessageScrollerContent. Inserting
	// older messages moves the previous first item, which enables prepend restore.
	// scrollAnchor stays false: this is a live group chat, not an anchored AI turn.
	return groups.flatMap((group) =>
		group.messages.map((message, index) => {
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
				<MessageScrollerItem key={message.id} messageId={message.id}>
					{message.id === oldestId && hasMoreOlder && (
						<div className="flex flex-col items-center gap-2 pb-3">
							<div ref={topSentinelRef} className="h-1" aria-hidden />
							{olderError && (
								<p role="alert" className="text-sm text-destructive">
									Ältere Nachrichten konnten nicht geladen werden.
								</p>
							)}
							<Button
								variant="ghost"
								disabled={loadingOlder}
								onClick={onLoadOlder}
								className="min-h-11"
							>
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
						<Marker variant="separator" className="py-3">
							<MarkerContent>{DAY_FORMAT.format(group.day)}</MarkerContent>
						</Marker>
					)}
					{message.kind === 'system' ? (
						<SystemMessage
							systemKind={(message as BubbleMessage & { systemKind?: string }).systemKind ?? null}
							payload={
								(message as BubbleMessage & { systemPayload?: Record<string, unknown> })
									.systemPayload ?? null
							}
						/>
					) : (
						<MessageGroup>
							<MessageBubble
								key={`${currentMemberId}:${message.id}`}
								message={message}
								sender={sender}
								currentMemberId={currentMemberId}
								isAdmin={isAdmin}
								isOwn={message.senderMemberId === currentMemberId}
								draftKey={`manawg:draft:${shareCode}:${currentMemberId}:chat:edit:${message.id}`}
								reactions={reactionsByMessage.get(message.id) ?? []}
								replyTo={replyTo}
								replyToSender={replyToSender}
								onReact={(emoji) => onReact(message.id, emoji)}
								onUnreact={(emoji) => onUnreact(message.id, emoji)}
								onEdit={(next) => onEdit(message.id, next)}
								onDelete={() => onDelete(message.id)}
								onReply={() => onReply(message.id)}
							/>
						</MessageGroup>
					)}
				</MessageScrollerItem>
			);
		}),
	);
}
