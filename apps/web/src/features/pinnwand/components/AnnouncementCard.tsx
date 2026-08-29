'use client';

import { DeleteConfirmButton } from '@/components/ui/DeleteConfirmButton';
import { CHIP_BUTTON, ICON_BUTTON } from '@/components/ui/styles';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { useDismissableMenu } from '@/core/hooks/useDismissableMenu';
import { formatRelativeTime, formatTimeFull } from '@/core/utils/time';
import type {
	Announcement,
	AnnouncementComment,
	AnnouncementSource,
	ReactionKey,
} from '@/features/pinnwand/components/announcement-types';
import { KIND_LABELS } from '@/features/pinnwand/components/constants';
import { buildPinnwandPrefill, getPinnwandPrefillHref } from '@/features/pinnwand/pinnwand-prefill';
import {
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Circle,
	ExternalLink,
	Eye,
	Hand,
	ListChecks,
	Loader2,
	MoreHorizontal,
	Pencil,
	Pin,
	PinOff,
	Receipt,
	Send,
	Sparkles,
	ThumbsUp,
	Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactElement, memo, useRef, useState } from 'react';

interface AnnouncementCardProps {
	announcement: Announcement;
	author: { name: string; color: string | null };
	deletePending: boolean;
	pinPending: boolean;
	statusPending: boolean;
	reactionPending: (reaction: ReactionKey) => boolean;
	compact: boolean;
	onDelete: () => void;
	onTogglePinned: () => void;
	onToggleStatus: () => void;
	onToggleReaction: (reaction: ReactionKey) => void;
	onAddComment: (content: string) => Promise<boolean>;
	onUpdateComment: (commentId: string, content: string) => Promise<boolean>;
	onDeleteComment: (commentId: string) => Promise<boolean>;
	currentMemberId: string;
	shareCode: string;
	highlighted: boolean;
}

const BODY_LINE_CLAMP = 6;

const SOURCE_LABELS: Record<AnnouncementSource, string | null> = {
	manual: null,
	system: 'System',
	chore_swap: 'Putzplan',
	expense: 'Ausgaben',
	shopping: 'Einkauf',
};

const REACTIONS: ReadonlyArray<{
	key: ReactionKey;
	label: string;
	icon: typeof Eye;
}> = [
	{ key: 'seen', label: 'Gesehen', icon: Eye },
	{ key: 'take', label: 'Übernehme ich', icon: Hand },
	{ key: 'ok', label: 'Passt', icon: ThumbsUp },
];

function actionLabelSubject(value: string, fallback: string): string {
	const normalized = value.trim().replace(/\s+/g, ' ');
	if (normalized.length === 0) return fallback;
	return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
}

export const AnnouncementCard = memo(function AnnouncementCard({
	announcement,
	author,
	deletePending,
	pinPending,
	statusPending,
	reactionPending,
	compact,
	onDelete,
	onTogglePinned,
	onToggleStatus,
	onToggleReaction,
	onAddComment,
	onUpdateComment,
	onDeleteComment,
	currentMemberId,
	shareCode,
	highlighted,
}: AnnouncementCardProps): ReactElement {
	const hasImage = Boolean(announcement.imageUrl);
	const bodyText = announcement.content.trim();
	const lineCount = bodyText.split('\n').length;
	const isLong = bodyText.length > 300 || lineCount > BODY_LINE_CLAMP;
	const [expanded, setExpanded] = useState(false);
	const sourceLabel = SOURCE_LABELS[announcement.source];
	const isResolved = announcement.status === 'resolved';
	const isPinned = Boolean(announcement.pinnedAt);
	const isSystem = announcement.source !== 'manual';
	const [commentsOpen, setCommentsOpen] = useState(announcement.comments.length > 0);
	const [commentDraft, setCommentDraft] = useState('');
	const [commentPending, setCommentPending] = useState(false);
	const commentPendingRef = useRef(false);
	const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
	const mobileActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
	const mobileActionsMenuRef = useRef<HTMLDivElement | null>(null);

	useDismissableMenu({
		open: mobileActionsOpen,
		onClose: () => setMobileActionsOpen(false),
		triggerRef: mobileActionsTriggerRef,
		menuRef: mobileActionsMenuRef,
	});

	const wgBaseHref = `/wg/${encodeURIComponent(shareCode)}`;
	const sourceHref = announcement.sourcePath ? `${wgBaseHref}${announcement.sourcePath}` : null;
	const takerNames = announcement.takers.map((taker) => taker.name);
	const actionSubject = actionLabelSubject(bodyText, 'leerer Beitrag');
	const takerLabel =
		takerNames.length === 0
			? null
			: takerNames.length === 1
				? `${takerNames[0]} übernimmt`
				: `${takerNames.slice(0, 2).join(', ')}${takerNames.length > 2 ? ` +${takerNames.length - 2}` : ''} übernehmen`;
	const workflowState = isResolved
		? 'erledigt'
		: takerNames.length > 0
			? 'übernommen'
			: announcement.comments.length > 0
				? 'wartet'
				: 'offen';
	const prefill = buildPinnwandPrefill(bodyText);

	async function submitComment(): Promise<void> {
		const text = commentDraft.trim();
		if (!text) return;
		if (commentPendingRef.current) return;
		commentPendingRef.current = true;
		setCommentPending(true);
		try {
			const ok = await onAddComment(text);
			if (ok) {
				setCommentDraft('');
				setCommentsOpen(true);
			}
		} finally {
			commentPendingRef.current = false;
			setCommentPending(false);
		}
	}

	return (
		<li
			id={`announcement-${announcement.id}`}
			className={`group scroll-mt-24 overflow-hidden rounded-lg border ${
				isSystem
					? 'border-[var(--accent)]/25 bg-[var(--accent)]/[0.04]'
					: 'border-[var(--border)] bg-[var(--bg-base)]'
			} ${isResolved ? 'opacity-80' : ''} ${
				highlighted
					? 'ring-2 ring-[var(--accent)]'
					: 'transition-colors hover:border-[var(--border-strong)]'
			}`}
		>
			<header className="flex items-center justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
				<div className="flex min-w-0 items-center gap-3">
					<MemberAvatar name={author.name} color={author.color} size={36} />
					<div className="min-w-0">
						<div className="truncate text-[14px] font-semibold text-[var(--text-1)]">
							{author.name}
						</div>
						<div className="flex flex-wrap items-center gap-1.5">
							<time
								dateTime={announcement.createdAt}
								title={formatTimeFull(announcement.createdAt)}
								className="text-[12px] leading-tight text-[var(--text-3)]"
							>
								{formatRelativeTime(announcement.createdAt)}
							</time>
							<span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-2)] ring-1 ring-inset ring-[var(--border)]">
								{KIND_LABELS[announcement.kind]}
							</span>
							{sourceLabel && (
								<span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
									{sourceLabel}
								</span>
							)}
							{isPinned && (
								<span className="inline-flex items-center gap-1 rounded-full bg-[var(--text-1)] px-2 py-0.5 text-[11px] font-semibold text-[var(--bg-base)]">
									<Pin className="h-3 w-3" aria-hidden />
									Fixiert
								</span>
							)}
							{isResolved && (
								<span className="inline-flex items-center gap-1 rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--success-fg)]">
									<CheckCircle2 className="h-3 w-3" aria-hidden />
									Geklärt
								</span>
							)}
							<span className="rounded-full border border-[var(--border)] bg-[var(--bg-base)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-2)]">
								{workflowState}
							</span>
						</div>
					</div>
				</div>
				<div className="hidden shrink-0 items-center gap-1 sm:flex">
					<button
						type="button"
						onClick={onTogglePinned}
						disabled={pinPending}
						aria-label={
							isPinned ? `Fixierung lösen: ${actionSubject}` : `Beitrag fixieren: ${actionSubject}`
						}
						aria-pressed={isPinned}
						className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						{pinPending ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : isPinned ? (
							<PinOff className="h-4 w-4" aria-hidden />
						) : (
							<Pin className="h-4 w-4" aria-hidden />
						)}
					</button>
					<button
						type="button"
						onClick={onToggleStatus}
						disabled={statusPending}
						aria-label={
							isResolved
								? `Beitrag wieder öffnen: ${actionSubject}`
								: `Als geklärt markieren: ${actionSubject}`
						}
						aria-pressed={isResolved}
						className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						{statusPending ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : isResolved ? (
							<CheckCircle2 className="h-4 w-4 text-[var(--success-fg)]" aria-hidden />
						) : (
							<Circle className="h-4 w-4" aria-hidden />
						)}
					</button>
					<DeleteConfirmButton
						id={announcement.id}
						onConfirm={onDelete}
						pending={deletePending}
						ariaLabel={`Beitrag entfernen: ${actionSubject}`}
						ariaLabelConfirm={`Beitrag entfernen bestätigen: ${actionSubject}`}
					/>
				</div>
				<div className="relative shrink-0 sm:hidden">
					<button
						ref={mobileActionsTriggerRef}
						type="button"
						onClick={() => setMobileActionsOpen((value) => !value)}
						aria-expanded={mobileActionsOpen}
						aria-haspopup="menu"
						aria-label={`Beitragsaktionen: ${actionSubject}`}
						className={ICON_BUTTON}
					>
						<MoreHorizontal className="h-4 w-4" aria-hidden />
					</button>
					{mobileActionsOpen && (
						<div
							ref={mobileActionsMenuRef}
							role="menu"
							aria-label={`Beitragsaktionen: ${actionSubject}`}
							className="absolute right-0 top-11 z-10 min-w-40 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)] py-1 text-[13px] shadow-lg"
						>
							<button
								role="menuitem"
								type="button"
								onClick={() => {
									setMobileActionsOpen(false);
									onTogglePinned();
								}}
								aria-label={
									isPinned
										? `Fixierung lösen: ${actionSubject}`
										: `Beitrag fixieren: ${actionSubject}`
								}
								className="flex h-11 w-full items-center gap-2 px-3 text-left text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
							>
								{isPinned ? (
									<PinOff className="h-3.5 w-3.5" aria-hidden />
								) : (
									<Pin className="h-3.5 w-3.5" aria-hidden />
								)}
								{isPinned ? 'Lösen' : 'Fixieren'}
							</button>
							<button
								role="menuitem"
								type="button"
								onClick={() => {
									setMobileActionsOpen(false);
									onToggleStatus();
								}}
								aria-label={
									isResolved
										? `Beitrag wieder öffnen: ${actionSubject}`
										: `Als geklärt markieren: ${actionSubject}`
								}
								className="flex h-11 w-full items-center gap-2 px-3 text-left text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
							>
								<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
								{isResolved ? 'Wieder öffnen' : 'Geklärt'}
							</button>
							<button
								role="menuitem"
								type="button"
								onClick={() => {
									setMobileActionsOpen(false);
									onDelete();
								}}
								aria-label={`Beitrag entfernen: ${actionSubject}`}
								className="flex h-11 w-full items-center gap-2 px-3 text-left text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--danger)]"
							>
								<Trash2 className="h-3.5 w-3.5" aria-hidden />
								Entfernen
							</button>
						</div>
					)}
				</div>
			</header>

			{hasImage && announcement.imageUrl && !compact && (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={announcement.imageUrl}
					alt={`Bildanhang: ${actionSubject}`}
					loading="lazy"
					className="block w-full bg-[var(--surface)] object-cover"
					style={{ maxHeight: '70vh', aspectRatio: 'auto' }}
				/>
			)}

			{bodyText.length > 0 && (
				<div className={`px-4 sm:px-5 ${compact ? 'pb-3 pt-1' : 'pb-4 pt-3'}`}>
					<p
						id={`announcement-body-${announcement.id}`}
						className={`whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--text-1)] ${
							(isLong && !expanded) || compact ? 'line-clamp-3' : ''
						}`}
					>
						{bodyText}
					</p>
					{isLong && !compact && (
						<button
							type="button"
							onClick={() => setExpanded((v) => !v)}
							aria-expanded={expanded}
							aria-controls={`announcement-body-${announcement.id}`}
							aria-label={
								expanded ? `Weniger anzeigen: ${actionSubject}` : `Mehr anzeigen: ${actionSubject}`
							}
							className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[13px] font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							{expanded ? (
								<>
									<ChevronUp className="h-3.5 w-3.5" aria-hidden />
									Weniger
								</>
							) : (
								<>
									<ChevronDown className="h-3.5 w-3.5" aria-hidden />
									Mehr anzeigen
								</>
							)}
						</button>
					)}
				</div>
			)}

			{takerLabel && (
				<div className="flex flex-wrap gap-1.5 border-t border-[var(--border)]/60 px-4 py-2.5 sm:px-5">
					<span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-3 text-[12px] font-medium text-[var(--accent)]">
						<Hand className="h-3.5 w-3.5" aria-hidden />
						{takerLabel}
					</span>
				</div>
			)}

			<footer className="flex flex-wrap gap-1.5 border-t border-[var(--border)]/70 px-4 py-3 sm:px-5">
				{sourceHref && (
					<Link
						href={sourceHref}
						aria-label={`Quelle öffnen: ${actionSubject}`}
						className={CHIP_BUTTON}
					>
						<ExternalLink className="h-3.5 w-3.5" aria-hidden />
						Öffnen
					</Link>
				)}
				<Link
					href={getPinnwandPrefillHref(shareCode, 'shopping', prefill)}
					aria-label={`Als Einkaufsartikel übernehmen: ${actionSubject}`}
					className={CHIP_BUTTON}
				>
					<ListChecks className="h-3.5 w-3.5" aria-hidden />
					Einkauf
				</Link>
				<Link
					href={getPinnwandPrefillHref(shareCode, 'chore', prefill)}
					aria-label={`Als Putzaufgabe übernehmen: ${actionSubject}`}
					className={CHIP_BUTTON}
				>
					<Sparkles className="h-3.5 w-3.5" aria-hidden />
					Aufgabe
				</Link>
				<Link
					href={getPinnwandPrefillHref(shareCode, 'expense', prefill)}
					aria-label={`Als Ausgabe übernehmen: ${actionSubject}`}
					className={CHIP_BUTTON}
				>
					<Receipt className="h-3.5 w-3.5" aria-hidden />
					Ausgabe
				</Link>
				{REACTIONS.map(({ key, label, icon: Icon }) => {
					const active = announcement.myReactions.includes(key);
					const count = announcement.reactionCounts[key] ?? 0;
					const displayLabel =
						key === 'take' && count > 0 ? (active ? 'Mein Task' : 'Übernommen') : label;
					return (
						<button
							key={key}
							type="button"
							onClick={() => onToggleReaction(key)}
							disabled={reactionPending(key)}
							aria-pressed={active}
							aria-label={
								active
									? `${label}-Reaktion entfernen: ${actionSubject}`
									: `${label}-Reaktion setzen: ${actionSubject}`
							}
							className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50 ${
								active
									? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
									: 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
							}`}
						>
							{reactionPending(key) ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
							) : (
								<Icon className="h-3.5 w-3.5" aria-hidden />
							)}
							{displayLabel}
							{count > 0 && <span className="tabular-nums">{count}</span>}
						</button>
					);
				})}
				{!isResolved && takerNames.length > 0 && (
					<button
						type="button"
						onClick={onToggleStatus}
						disabled={statusPending}
						aria-label={`Als erledigt markieren: ${actionSubject}`}
						className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-3 text-[12px] font-medium text-[var(--success-fg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						{statusPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
						) : (
							<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
						)}
						Erledigt
					</button>
				)}
				{isResolved && isPinned && (
					<button
						type="button"
						onClick={onTogglePinned}
						disabled={pinPending}
						aria-label={`Fixierung lösen: ${actionSubject}`}
						className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						{pinPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
						) : (
							<PinOff className="h-3.5 w-3.5" aria-hidden />
						)}
						Pin lösen
					</button>
				)}
				{isResolved && !announcement.myReactions.includes('ok') && (
					<button
						type="button"
						onClick={() => onToggleReaction('ok')}
						disabled={reactionPending('ok')}
						aria-label={`Danke-Reaktion setzen: ${actionSubject}`}
						className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-3 text-[12px] font-medium text-[var(--success-fg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						{reactionPending('ok') ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
						) : (
							<ThumbsUp className="h-3.5 w-3.5" aria-hidden />
						)}
						Danke
					</button>
				)}
				<button
					type="button"
					onClick={() => setCommentsOpen((value) => !value)}
					aria-expanded={commentsOpen}
					aria-controls={`announcement-comments-${announcement.id}`}
					aria-label={`Antworten anzeigen: ${actionSubject}`}
					className={CHIP_BUTTON}
				>
					Antworten
					{announcement.comments.length > 0 && (
						<span className="tabular-nums">{announcement.comments.length}</span>
					)}
				</button>
			</footer>

			{commentsOpen && (
				<section
					id={`announcement-comments-${announcement.id}`}
					className="space-y-3 border-t border-[var(--border)]/70 bg-[var(--surface)]/40 px-4 py-3 sm:px-5"
				>
					{announcement.comments.length > 0 && (
						<ul className="space-y-2">
							{announcement.comments.map((comment) => (
								<CommentRow
									key={comment.id}
									comment={comment}
									canEdit={comment.memberId === currentMemberId}
									onUpdate={(content) => onUpdateComment(comment.id, content)}
									onDelete={() => onDeleteComment(comment.id)}
								/>
							))}
						</ul>
					)}
					<div className="flex gap-2">
						<textarea
							value={commentDraft}
							onChange={(e) => setCommentDraft(e.target.value)}
							maxLength={600}
							rows={1}
							aria-label={`Antwort verfassen: ${actionSubject}`}
							placeholder="Antwort schreiben"
							className="min-h-11 flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						/>
						<button
							type="button"
							onClick={() => void submitComment()}
							disabled={commentPending || commentDraft.trim().length === 0}
							aria-label={`Antwort senden: ${actionSubject}`}
							className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--text-1)] text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-40"
						>
							{commentPending ? (
								<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
							) : (
								<Send className="h-4 w-4" aria-hidden />
							)}
						</button>
					</div>
				</section>
			)}
		</li>
	);
});

function CommentRow({
	comment,
	canEdit,
	onUpdate,
	onDelete,
}: {
	comment: AnnouncementComment;
	canEdit: boolean;
	onUpdate: (content: string) => Promise<boolean>;
	onDelete: () => Promise<boolean>;
}): ReactElement {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(comment.content);
	const [pending, setPending] = useState(false);
	const pendingRef = useRef(false);
	const actionSubject = actionLabelSubject(comment.content, 'leerer Kommentar');

	async function save(): Promise<void> {
		const text = draft.trim();
		if (!text) return;
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		try {
			const ok = await onUpdate(text);
			if (ok) setEditing(false);
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	}

	async function remove(): Promise<void> {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		try {
			await onDelete();
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	}

	return (
		<li className="flex gap-2.5">
			<MemberAvatar name={comment.authorName} color={comment.authorColor} size={26} />
			<div className="min-w-0 flex-1 rounded-xl bg-[var(--bg-base)] px-3 py-2 text-[13px] shadow-sm ring-1 ring-inset ring-[var(--border)]">
				<div className="mb-0.5 flex flex-wrap items-center gap-1.5">
					<span className="font-semibold text-[var(--text-1)]">{comment.authorName}</span>
					<time
						dateTime={comment.createdAt}
						title={formatTimeFull(comment.createdAt)}
						className="text-[11px] text-[var(--text-3)]"
					>
						{formatRelativeTime(comment.createdAt)}
					</time>
					{canEdit && (
						<div className="ml-auto flex items-center gap-1">
							<button
								type="button"
								onClick={() => {
									setEditing((value) => {
										const next = !value;
										if (next) setDraft(comment.content);
										return next;
									});
								}}
								disabled={pending}
								aria-label={`Kommentar bearbeiten: ${actionSubject}`}
								className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<Pencil className="h-3.5 w-3.5" aria-hidden />
							</button>
							<button
								type="button"
								onClick={() => void remove()}
								disabled={pending}
								aria-label={`Kommentar entfernen: ${actionSubject}`}
								className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--text-3)] transition-colors hover:bg-[var(--danger)]/5 hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:opacity-50"
							>
								<Trash2 className="h-3.5 w-3.5" aria-hidden />
							</button>
						</div>
					)}
				</div>
				{editing ? (
					<div className="flex gap-2">
						<textarea
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							disabled={pending}
							maxLength={600}
							rows={2}
							aria-label="Kommentar bearbeiten"
							className="min-h-16 flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[13px] text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
						/>
						<button
							type="button"
							onClick={() => void save()}
							disabled={pending || draft.trim().length === 0}
							aria-label={`Kommentar speichern: ${actionSubject}`}
							className="h-11 rounded-xl bg-[var(--text-1)] px-3 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-40"
						>
							OK
						</button>
					</div>
				) : (
					<p className="whitespace-pre-wrap text-[var(--text-2)]">{comment.content}</p>
				)}
			</div>
		</li>
	);
}
