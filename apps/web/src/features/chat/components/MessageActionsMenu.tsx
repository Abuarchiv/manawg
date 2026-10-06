'use client';

import { useToast } from '@/components/ui/Toast';
import { BubbleContent } from '@/components/ui/bubble';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { copyText } from '@/core/utils/clipboard';
import { cn } from '@/shared/lib/cn';
import { haptic } from '@/shared/lib/haptics';
import { Copy, Pencil, Reply, Smile, Trash2 } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { BubbleMessage } from '../chat-types';

export const BUBBLE_TEXT = 'rounded-2xl px-3 py-1.5 text-[14px] leading-snug';

interface MessageActionsMenuProps {
	message: BubbleMessage;
	senderName: string;
	isOwn: boolean;
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

/** The bubble itself as a menu trigger: tapping it opens reply, react, copy, edit and delete. */
export function MessageActionsMenu({
	message,
	senderName,
	isOwn,
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
	const toast = useToast();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				ref={triggerRef}
				disabled={disabled}
				render={
					<BubbleContent
						// The trigger would otherwise set data-slot="dropdown-menu-trigger"; the bubble colors key off the slot.
						data-slot="bubble-content"
						render={<button type="button" />}
						className={cn(BUBBLE_TEXT, 'cursor-pointer')}
					/>
				}
			>
				<span className="sr-only">Aktionen für Nachricht von {senderName}: </span>
				{replyTo && (
					<span className="mb-1.5 block rounded-md border-s-2 border-current/40 bg-current/5 px-2 py-1">
						<span className="block text-xs font-medium [overflow-wrap:anywhere]">
							↪ {replyToSender?.name ?? 'Unbekannt'}
						</span>
						<span className="line-clamp-2 whitespace-pre-wrap text-xs opacity-80 [overflow-wrap:anywhere]">
							{replyTo.deletedAt
								? 'Diese Nachricht wurde gelöscht.'
								: (replyTo.body ?? (replyTo.imageUrl ? 'Bild' : '…'))}
						</span>
					</span>
				)}
				{/* Spans instead of <p>: paragraph elements are not allowed inside a <button>. */}
				<span className="block whitespace-pre-wrap [overflow-wrap:anywhere]">
					{message.body}
					{timeStamp}
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align={isOwn ? 'end' : 'start'} className="w-48">
				<DropdownMenuGroup>
					<DropdownMenuItem className="min-h-11" disabled={reactionPending} onClick={onReactOpen}>
						<Smile aria-hidden /> Reagieren
					</DropdownMenuItem>
					<DropdownMenuItem
						className="min-h-11"
						onClick={() => {
							haptic('selection');
							onReply(message.id);
						}}
					>
						<Reply aria-hidden /> Antworten
					</DropdownMenuItem>
					{message.body && (
						<DropdownMenuItem
							className="min-h-11"
							// copyText catches a rejected async clipboard call (otherwise a pageerror without feedback).
							onClick={() =>
								void copyText(message.body ?? '').then((copied) =>
									copied
										? toast.success('Nachricht kopiert.')
										: toast.error('Kopieren hat nicht geklappt. Versuche es erneut.'),
								)
							}
						>
							<Copy aria-hidden /> Kopieren
						</DropdownMenuItem>
					)}
					{editable && (
						<DropdownMenuItem className="min-h-11" onClick={onEdit}>
							<Pencil aria-hidden /> {hasDraft ? 'Entwurf weiterbearbeiten' : 'Bearbeiten'}
						</DropdownMenuItem>
					)}
					{deletable && (
						<DropdownMenuItem className="min-h-11" variant="destructive" onClick={onDelete}>
							<Trash2 aria-hidden /> Löschen
						</DropdownMenuItem>
					)}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
