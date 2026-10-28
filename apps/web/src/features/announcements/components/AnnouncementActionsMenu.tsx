'use client';

import {
	CheckCircle2,
	ExternalLink,
	Eye,
	Hand,
	ListChecks,
	type LucideIcon,
	MoreHorizontal,
	Pencil,
	Pin,
	PinOff,
	Receipt,
	Sparkles,
	ThumbsUp,
	Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import {
	CONVERSION_TARGETS,
	type ConversionTarget,
} from '@/features/announcements/announcement-card-model';
import { getAnnouncementPrefillHref } from '@/features/announcements/announcement-prefill';
import type { ReactionKey } from './announcement-types';

export const REACTION_ICONS: Record<ReactionKey, LucideIcon> = {
	seen: Eye,
	take: Hand,
	ok: ThumbsUp,
};

const CONVERSION_ICONS: Record<ConversionTarget, LucideIcon> = {
	shopping: ListChecks,
	chore: Sparkles,
	expense: Receipt,
};

interface AnnouncementActionsMenuProps {
	actionSubject: string;
	shareCode: string;
	sourceHref: string | null;
	/** Prefill for turning a manual post into a shopping item, chore or expense; null otherwise. */
	prefill: Parameters<typeof getAnnouncementPrefillHref>[2] | null;
	hiddenReactions: ReactionKey[];
	reactionPending: (key: ReactionKey) => boolean;
	isPinned: boolean;
	isResolved: boolean;
	canModerate: boolean;
	canEdit: boolean;
	canResolve: boolean;
	deletePending: boolean;
	pinPending: boolean;
	statusPending: boolean;
	onReact: (key: ReactionKey) => void;
	onTogglePinned: () => void;
	onToggleStatus: () => void;
	onEdit: () => void;
	onDelete: () => void;
}

/** The ⋯ menu of a card: source, conversions, less used reactions and moderation. */
export function AnnouncementActionsMenu({
	actionSubject,
	shareCode,
	sourceHref,
	prefill,
	hiddenReactions,
	reactionPending,
	isPinned,
	isResolved,
	canModerate,
	canEdit,
	canResolve,
	deletePending,
	pinPending,
	statusPending,
	onReact,
	onTogglePinned,
	onToggleStatus,
	onEdit,
	onDelete,
}: AnnouncementActionsMenuProps) {
	const t = useTranslations('pinboard');
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button variant="ghost" size="icon" className="-my-1 size-8" />}
				aria-label={t('card.actionsAria', { subject: actionSubject })}
				disabled={deletePending}
			>
				<MoreHorizontal aria-hidden />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
				<DropdownMenuGroup>
					{sourceHref && (
						<DropdownMenuItem
							render={<Link href={sourceHref} />}
							className="min-h-11"
							aria-label={t('card.openSourceAria', { subject: actionSubject })}
						>
							<ExternalLink aria-hidden /> {t('card.openSource')}
						</DropdownMenuItem>
					)}
					{prefill &&
						CONVERSION_TARGETS.map((target) => {
							const Icon = CONVERSION_ICONS[target];
							return (
								<DropdownMenuItem
									key={target}
									render={<Link href={getAnnouncementPrefillHref(shareCode, target, prefill)} />}
									className="min-h-11"
									aria-label={t(`convert.${target}Aria`, { subject: actionSubject })}
								>
									<Icon aria-hidden /> {t(`convert.${target}`)}
								</DropdownMenuItem>
							);
						})}
					{hiddenReactions.map((key) => {
						const Icon = REACTION_ICONS[key];
						const label = t(`reaction.${key}`);
						return (
							<DropdownMenuItem
								key={key}
								onClick={() => onReact(key)}
								disabled={reactionPending(key)}
								className="min-h-11"
								aria-label={t('card.reactAria', { label, subject: actionSubject })}
							>
								<Icon aria-hidden /> {label}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuGroup>
				{(canEdit || canModerate || canResolve) && <DropdownMenuSeparator />}
				<DropdownMenuGroup>
					{canEdit && (
						<DropdownMenuItem
							onClick={onEdit}
							className="min-h-11"
							aria-label={t('card.editAria', { subject: actionSubject })}
						>
							<Pencil /> {t('card.edit')}
						</DropdownMenuItem>
					)}
					{canModerate && (
						<DropdownMenuItem
							onClick={onTogglePinned}
							disabled={pinPending}
							className="min-h-11"
							aria-label={t(isPinned ? 'card.unpinAria' : 'card.pinAria', {
								subject: actionSubject,
							})}
						>
							{pinPending ? <Spinner /> : isPinned ? <PinOff /> : <Pin />}
							{t(isPinned ? 'card.unpin' : 'card.pin')}
						</DropdownMenuItem>
					)}
					{canResolve && (
						<DropdownMenuItem
							onClick={onToggleStatus}
							disabled={statusPending}
							className="min-h-11"
							aria-label={t(isResolved ? 'card.reopenAria' : 'card.resolveAria', {
								subject: actionSubject,
							})}
						>
							{statusPending ? <Spinner /> : <CheckCircle2 />}
							{t(isResolved ? 'card.reopen' : 'card.resolve')}
						</DropdownMenuItem>
					)}
					{canModerate && (
						<DropdownMenuItem
							variant="destructive"
							onClick={onDelete}
							className="min-h-11"
							aria-label={t('card.removeAria', { subject: actionSubject })}
						>
							<Trash2 /> {t('card.remove')}
						</DropdownMenuItem>
					)}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
