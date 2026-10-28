'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { useWg } from '@/components/wg/WgContextProvider';
import { useStableCallback } from '@/core/hooks/use-stable-callback';
import { haptic } from '@/shared/lib/haptics';
import { chatDraftKey } from '../chat-draft';
import { previewBody } from '../chat-pure';
import { type ChatMessageDto, type ChatReactionRow, useChatRoom } from '../hooks/use-chat-room';
import { useChatViewportFit } from '../hooks/use-chat-viewport-fit';
import { ChatBanner } from './ChatBanner';
import { ChatComposer } from './ChatComposer';
import {
	ChatEmptyPlaceholder,
	ChatLoadErrorPlaceholder,
	ChatLoadingPlaceholder,
} from './ChatPlaceholder';
import { MessageList } from './MessageList';

const HIGHLIGHT_MS = 2500;
// Lets the first page lay out before the deep-linked message is scrolled to.
const HASH_JUMP_DELAY_MS = 120;
const SCROLL_AFTER_SEND_DELAY_MS = 100;

interface ChatViewProps {
	wgId: string;
	shareCode: string;
	initialMessages: ChatMessageDto[];
	initialReactions: ChatReactionRow[];
}

export function ChatView({ wgId, shareCode, initialMessages, initialReactions }: ChatViewProps) {
	const t = useTranslations('chat.view');
	const { members, identity, isAdmin } = useWg();
	const chat = useChatRoom({ wgId, shareCode, initialMessages, initialReactions });
	const { messages } = chat;
	const chatRootRef = useRef<HTMLDivElement | null>(null);
	const [replyToId, setReplyToId] = useState<string | null>(null);
	const [replyFocusRequest, setReplyFocusRequest] = useState(0);
	useChatViewportFit(chatRootRef);

	const readerIds = useMemo(
		() => members.filter((m) => m.active && m.id !== identity.memberId).map((m) => m.id),
		[members, identity.memberId],
	);
	const listMembers = useMemo(
		() => members.map((m) => ({ id: m.id, name: m.name, color: m.color ?? null })),
		[members],
	);

	// A mention push opens `/chat#message-<id>`: bring that message into view once it is rendered.
	const jumpedToHashRef = useRef(false);
	const messageCount = messages.length;
	const { hasMoreOlder, loadingOlder, olderError } = chat;
	const loadOlderForHash = useStableCallback(() => void chat.loadOlder());
	// A mention opened while the chat is already showing changes only the fragment: run the jump again.
	const [hashVersion, setHashVersion] = useState(0);
	useEffect(() => {
		const onHashChange = () => {
			jumpedToHashRef.current = false;
			setHashVersion((version) => version + 1);
		};
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: hashVersion restarts the jump when the fragment changes
	useEffect(() => {
		if (jumpedToHashRef.current || messageCount === 0) return;
		const target = /^#(message-[\w-]+)$/.exec(window.location.hash)?.[1];
		if (!target) {
			jumpedToHashRef.current = true;
			return;
		}
		const timer = window.setTimeout(() => {
			const element = document.getElementById(target);
			if (!element) {
				// An older message is not in the first page: page backwards until it appears or the
				// history is exhausted.
				if (hasMoreOlder && !loadingOlder && !olderError) loadOlderForHash();
				else if (!hasMoreOlder) jumpedToHashRef.current = true;
				return;
			}
			jumpedToHashRef.current = true;
			element.scrollIntoView({ block: 'center' });
			element.classList.add('ring-2', 'ring-inset', 'ring-ring');
			window.setTimeout(
				() => element.classList.remove('ring-2', 'ring-inset', 'ring-ring'),
				HIGHLIGHT_MS,
			);
		}, HASH_JUMP_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [messageCount, hasMoreOlder, loadingOlder, olderError, loadOlderForHash, hashVersion]);

	const replyTo = replyToId ? (messages.find((m) => m.id === replyToId) ?? null) : null;
	const replyToSender = replyTo?.senderMemberId
		? (members.find((m) => m.id === replyTo.senderMemberId) ?? null)
		: null;

	const stableLoadOlder = useStableCallback(() => void chat.loadOlder());
	const stableReact = useStableCallback(chat.react);
	const stableUnreact = useStableCallback(chat.unreact);
	const stableEdit = useStableCallback(chat.editMessage);
	const stableDelete = useStableCallback(chat.deleteMessage);
	// Always bring the own message to the end of the list, even when scrolled up.
	const send = useStableCallback(async (input: Parameters<typeof chat.sendMessage>[0]) => {
		const ok = await chat.sendMessage(input);
		if (ok) {
			setTimeout(() => {
				const el = chat.scrollRef.current;
				if (el) el.scrollTop = el.scrollHeight;
			}, SCROLL_AFTER_SEND_DELAY_MS);
		}
		return ok;
	});
	const onReply = useCallback((id: string) => {
		setReplyToId(id);
		setReplyFocusRequest((request) => request + 1);
	}, []);

	return (
		<div ref={chatRootRef} className="relative flex min-h-0 flex-1 flex-col bg-background">
			{chat.readError && (
				<ChatBanner
					message={t('readError')}
					actionLabel={t('readRetry')}
					onAction={chat.markLatestRead}
				/>
			)}
			{chat.refreshError && !chat.bootstrapError && !chat.bootstrapping && (
				<ChatBanner
					message={t('stale')}
					actionLabel={t('retry')}
					onAction={() => void chat.refresh()}
				/>
			)}
			<MessageScrollerProvider
				autoScroll
				defaultScrollPosition="end"
				scrollEdgeThreshold={120}
				scrollPreviousItemPeek={0}
			>
				<MessageScroller className="flex-1">
					<MessageScrollerViewport
						ref={chat.scrollRef}
						preserveScrollOnPrepend
						role="log"
						aria-label={t('logAria')}
						className="[scroll-behavior:auto]!"
					>
						<MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 px-3 py-2">
							{chat.bootstrapping ? (
								<ChatLoadingPlaceholder />
							) : chat.bootstrapError ? (
								<ChatLoadErrorPlaceholder onRetry={() => void chat.loadInitialMessages()} />
							) : messages.length === 0 && !chat.hasMoreOlder ? (
								<ChatEmptyPlaceholder />
							) : (
								<MessageList
									messages={messages}
									members={listMembers}
									currentMemberId={identity.memberId}
									shareCode={shareCode}
									firstUnreadId={chat.firstUnreadId}
									isAdmin={isAdmin}
									reactionsByMessage={chat.reactionsByMessage}
									reads={chat.reads}
									readerIds={readerIds}
									hasMoreOlder={chat.hasMoreOlder}
									loadingOlder={chat.loadingOlder}
									olderError={chat.olderError}
									scrollRef={chat.scrollRef}
									onLoadOlder={stableLoadOlder}
									onReact={stableReact}
									onUnreact={stableUnreact}
									onEdit={stableEdit}
									onDelete={stableDelete}
									onReply={onReply}
								/>
							)}
							{/* No MessageScrollerItem: an item before the real messages would consume the one-time start position "end" on an empty list. */}
							<div ref={chat.readSentinelRef} className="h-px shrink-0" aria-hidden />
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton
						direction="end"
						aria-label={t('scrollEnd')}
						behavior="smooth"
						className="inset-s-auto end-3 translate-x-0 rounded-full shadow-md rtl:translate-x-0"
						onClick={() => haptic('selection')}
					>
						<ChevronDown aria-hidden />
						<span className="sr-only">{t('scrollEnd')}</span>
					</MessageScrollerButton>
				</MessageScroller>
			</MessageScrollerProvider>
			<ChatComposer
				key={`${shareCode}:${identity.memberId}`}
				draftKey={chatDraftKey(shareCode, identity.memberId)}
				error={chat.sendError}
				members={members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name }))}
				currentMemberId={identity.memberId}
				replyToMessageId={replyToId}
				replyFocusRequest={replyFocusRequest}
				replyToPreview={
					replyTo
						? previewBody(replyTo.body ?? (replyTo.imageUrl ? t('imagePreview') : ''), 80)
						: null
				}
				replyToSenderName={replyToSender?.name ?? null}
				onClearReply={() => setReplyToId(null)}
				onRestoreReply={setReplyToId}
				onSend={send}
			/>
		</div>
	);
}
