'use client';

import { useEffect, useRef } from 'react';
import { groupMessagesByDay } from '../chat-pure';
import { type BubbleMessage, MessageBubble, type ReactionSummary } from './MessageBubble';
import { SystemMessage } from './SystemMessage';

const PAGE_SIZE = 50;

interface MessageListMember {
	id: string;
	name: string;
	color: string | null;
}

interface MessageListProps {
	messages: BubbleMessage[];
	members: MessageListMember[];
	currentMemberId: string;
	isAdmin: boolean;
	reactionsByMessage: Map<string, ReactionSummary[]>;
	hasMoreOlder: boolean;
	loadingOlder: boolean;
	onLoadOlder: () => void;
	onReact: (messageId: string, emoji: string) => void;
	onUnreact: (messageId: string, emoji: string) => void;
	onEdit: (messageId: string, next: string) => Promise<void>;
	onDelete: (messageId: string) => Promise<void>;
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
	isAdmin,
	reactionsByMessage,
	hasMoreOlder,
	loadingOlder,
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
		if (!sentinel || !hasMoreOlder || messages.length < PAGE_SIZE) return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && !loadingOlder) onLoadOlder();
				}
			},
			{ threshold: 0.1 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [hasMoreOlder, loadingOlder, onLoadOlder, messages.length]);

	const messagesById = new Map(messages.map((m) => [m.id, m]));
	const memberLookup = new Map(members.map((m) => [m.id, m]));
	const groups = groupMessagesByDay(messages);

	return (
		<div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end px-3 py-3 sm:px-4">
			<div ref={topSentinelRef} className="h-2 shrink-0" aria-hidden />
			{hasMoreOlder && (
				<output
					aria-live="polite"
					aria-busy={loadingOlder}
					className="py-2 text-center text-[12px] text-[var(--text-3)]"
				>
					{loadingOlder
						? 'Ältere Nachrichten werden geladen…'
						: 'Scrolle nach oben für ältere Nachrichten'}
				</output>
			)}
			{groups.map((group) => (
				<div key={group.key}>
					<div className="pointer-events-none sticky top-0 z-[5] my-2 flex justify-center">
						<span className="pointer-events-auto mx-auto inline-block rounded-full bg-[var(--bg-base)]/95 px-3 py-0.5 text-[11px] font-semibold text-[var(--text-3)] ring-1 ring-inset ring-[var(--border)] backdrop-blur">
							{DAY_FORMAT.format(group.day)}
						</span>
					</div>
					{group.messages.map((message) => {
						if (message.kind === 'system') {
							return (
								<SystemMessage
									key={message.id}
									systemKind={
										(message as BubbleMessage & { systemKind?: string }).systemKind ?? null
									}
									payload={
										(message as BubbleMessage & { systemPayload?: Record<string, unknown> })
											.systemPayload ?? null
									}
								/>
							);
						}
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
							<MessageBubble
								key={message.id}
								message={message}
								sender={sender}
								currentMemberId={currentMemberId}
								isAdmin={isAdmin}
								isOwn={message.senderMemberId === currentMemberId}
								reactions={reactionsByMessage.get(message.id) ?? []}
								replyTo={replyTo}
								replyToSender={replyToSender}
								onReact={(emoji) => onReact(message.id, emoji)}
								onUnreact={(emoji) => onUnreact(message.id, emoji)}
								onEdit={(next) => onEdit(message.id, next)}
								onDelete={() => onDelete(message.id)}
								onReply={() => onReply(message.id)}
							/>
						);
					})}
				</div>
			))}
		</div>
	);
}
