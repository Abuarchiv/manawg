'use client';

import { useToast } from '@/components/ui/Toast';
import { BubbleContent } from '@/components/ui/bubble';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { memberTint } from '@/components/wg/MemberAvatar';
import { useWg } from '@/components/wg/WgContextProvider';
import { copyText } from '@/core/utils/clipboard';
import { cn } from '@/shared/lib/cn';
import { haptic } from '@/shared/lib/haptics';
import { Copy, ExternalLink, Pencil, Plus, Reply, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, type RefObject, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { reactorNames } from '../chat-reactions';
import { extractLinks, splitMentions } from '../chat-text';
import type { BubbleMessage, ReactionSummary } from '../chat-types';

export const BUBBLE_TEXT = 'rounded-lg px-2.5 py-1.5 text-body leading-snug';
/** The reaction bar on top of the menu, as in WhatsApp. More emojis sit behind "+". */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

interface MessageActionsMenuProps {
	message: BubbleMessage;
	senderName: string;
	isOwn: boolean;
	/** First bubble of a run from someone else: their name sits inside the bubble. */
	showSenderName: boolean;
	open: boolean;
	onOpenChange: (open: boolean, reason?: string) => void;
	reactions: ReactionSummary[];
	onQuickReact: (emoji: string, mine: boolean) => void;
	replyTo: BubbleMessage | null;
	replyToSender: { name: string } | null;
	timeStamp: ReactNode;
	triggerRef: RefObject<HTMLButtonElement | null>;
	disabled: boolean;
	reactionPending: boolean;
	editable: boolean;
	deletable: boolean;
	hasDraft: boolean;
	onReactOpen: () => void;
	onReply: (messageId: string) => void;
	onEdit: () => void;
	onDelete: () => void;
}

/**
 * While the menu is open the page behind it is dimmed and blurred; this puts a sharp, inert copy of the
 * pressed bubble (tail included) above that backdrop at the same viewport position, as WhatsApp does.
 */
function PressedBubbleCopy({ source }: { source: HTMLElement | null }) {
	const [copy, setCopy] = useState<{ html: string; rect: DOMRect } | null>(null);
	useLayoutEffect(() => {
		const bubble = source?.parentElement;
		setCopy(bubble ? { html: bubble.outerHTML, rect: bubble.getBoundingClientRect() } : null);
	}, [source]);
	if (!copy) return null;
	const { rect } = copy;
	return createPortal(
		<div
			aria-hidden
			inert
			className="pointer-events-none fixed z-50 flex"
			style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: DOM copy of an already rendered, React-escaped bubble
			dangerouslySetInnerHTML={{ __html: copy.html }}
		/>,
		document.body,
	);
}

/** The bubble itself as a menu trigger: tap, long press or right click opens react, reply, copy, edit and delete. */
export function MessageActionsMenu({
	message,
	senderName,
	isOwn,
	showSenderName,
	open,
	onOpenChange,
	reactions,
	onQuickReact,
	replyTo,
	replyToSender,
	timeStamp,
	triggerRef,
	disabled,
	reactionPending,
	editable,
	deletable,
	hasDraft,
	onReactOpen,
	onReply,
	onEdit,
	onDelete,
}: MessageActionsMenuProps) {
	const t = useTranslations('chat');
	const tCommon = useTranslations('common');
	const { members, identity } = useWg();
	const ownName = members.find((m) => m.id === identity.memberId)?.name;
	const bodySegments = useMemo(
		() =>
			splitMentions(
				message.body ?? '',
				members.map((m) => m.name),
			),
		[message.body, members],
	);
	// The bubble is a <button>, so links cannot sit inside it; they open from the menu instead.
	const links = useMemo(() => extractLinks(message.body ?? ''), [message.body]);
	const toast = useToast();
	return (
		<>
			{open && <PressedBubbleCopy source={triggerRef.current} />}
			<DropdownMenu
				open={open}
				onOpenChange={(next, details) => onOpenChange(next, details.reason)}
			>
				<DropdownMenuTrigger
					ref={triggerRef}
					disabled={disabled}
					onContextMenu={(event) => {
						event.preventDefault();
						if (!disabled) onOpenChange(true);
					}}
					render={
						<BubbleContent
							// The trigger would otherwise set data-slot="dropdown-menu-trigger"; the bubble colors key off the slot.
							data-slot="bubble-content"
							render={<button type="button" />}
							// No text selection or iOS callout: a long press opens the menu instead.
							className={cn(BUBBLE_TEXT, 'cursor-pointer select-none [-webkit-touch-callout:none]')}
						/>
					}
				>
					<span className="sr-only">{t('menu.actionsFor', { name: senderName })}</span>
					{showSenderName && (
						<span
							aria-hidden
							className="block text-xs font-medium [overflow-wrap:anywhere]"
							style={{ color: memberTint(senderName).color }}
						>
							{senderName}
						</span>
					)}
					{(replyTo || message.replyToMessageId) && (
						<span className="mb-1.5 block rounded-md border-s-2 border-current/40 bg-current/5 px-2 py-1">
							{/* replyTo is null when the quoted message is older than the loaded pages. */}
							<span className="block text-xs font-medium [overflow-wrap:anywhere]">
								<Reply aria-hidden className="me-1 inline size-3" />
								{replyTo
									? (replyToSender?.name ?? tCommon('unknownPerson'))
									: t('menu.replyToOlder')}
							</span>
							{replyTo && (
								<span className="line-clamp-2 whitespace-pre-wrap text-xs opacity-80 [overflow-wrap:anywhere]">
									{replyTo.deletedAt
										? t('deleted')
										: (replyTo.body ?? (replyTo.imageUrl ? t('view.imagePreview') : '…'))}
								</span>
							)}
						</span>
					)}
					{/* Spans instead of <p>: paragraph elements are not allowed inside a <button>. */}
					<span className="block whitespace-pre-wrap [overflow-wrap:anywhere]">
						{bodySegments.map((segment, index) =>
							segment.mention ? (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: segments are static per body
									key={index}
									className={cn(
										'font-semibold',
										segment.mention === ownName && 'underline underline-offset-2',
									)}
								>
									{segment.text}
								</span>
							) : (
								segment.text
							),
						)}
						{timeStamp}
					</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent backdrop align={isOwn ? 'end' : 'start'} className="w-auto min-w-48">
					<DropdownMenuGroup
						aria-label={t('menu.reactGroup')}
						className="grid max-w-[calc(100vw-2rem)] grid-cols-7 items-center gap-0.5"
					>
						{QUICK_REACTIONS.map((emoji) => {
							const mine = reactions.some((reaction) => reaction.emoji === emoji && reaction.mine);
							return (
								<DropdownMenuItem
									key={emoji}
									aria-label={t(mine ? 'menu.reactionRemove' : 'menu.reactWith', { emoji })}
									disabled={reactionPending}
									className={cn(
										'h-11 w-auto min-w-0 justify-center rounded-full p-0 text-[22px] leading-none',
										mine && 'bg-accent',
									)}
									onClick={() => onQuickReact(emoji, mine)}
								>
									{emoji}
								</DropdownMenuItem>
							);
						})}
						<DropdownMenuItem
							aria-label={t('menu.moreReactions')}
							disabled={reactionPending}
							className="h-11 w-auto min-w-0 justify-center rounded-full bg-muted p-0"
							onClick={onReactOpen}
						>
							<Plus aria-hidden />
						</DropdownMenuItem>
					</DropdownMenuGroup>
					{reactions.length > 0 && (
						// Touch has no tooltip: list who reacted here (aria-hidden: the reaction chips already name them).
						<div
							aria-hidden="true"
							className="px-2 py-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]"
						>
							{reactions.map((reaction) => (
								<div key={reaction.emoji}>
									{reaction.emoji}{' '}
									{reactorNames(reaction.memberIds, members, identity.memberId, {
										you: t('bubble.you'),
										former: t('bubble.formerMember'),
									})}
								</div>
							))}
						</div>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem
							className="min-h-11"
							onClick={() => {
								haptic('selection');
								onReply(message.id);
							}}
						>
							<Reply aria-hidden /> {t('menu.reply')}
						</DropdownMenuItem>
						{message.body && (
							<DropdownMenuItem
								className="min-h-11"
								// copyText catches a rejected async clipboard call (otherwise a pageerror without feedback).
								onClick={() =>
									void copyText(message.body ?? '').then((copied) =>
										copied ? toast.success(t('menu.copied')) : toast.error(t('menu.copyFailed')),
									)
								}
							>
								<Copy aria-hidden /> {t('menu.copy')}
							</DropdownMenuItem>
						)}
						{links.map((url) => (
							<DropdownMenuItem
								key={url}
								className="min-h-11"
								// biome-ignore lint/a11y/useAnchorContent: the menu item renders its children into this anchor
								render={<a href={url} target="_blank" rel="noopener noreferrer" />}
							>
								<ExternalLink aria-hidden />
								{links.length > 1
									? t('menu.openLinkHost', { host: new URL(url).hostname })
									: t('menu.openLink')}
							</DropdownMenuItem>
						))}
						{editable && (
							<DropdownMenuItem className="min-h-11" onClick={onEdit}>
								<Pencil aria-hidden /> {hasDraft ? t('menu.editDraft') : t('menu.edit')}
							</DropdownMenuItem>
						)}
						{deletable && (
							<DropdownMenuItem className="min-h-11" variant="destructive" onClick={onDelete}>
								<Trash2 aria-hidden /> {t('menu.delete')}
							</DropdownMenuItem>
						)}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
