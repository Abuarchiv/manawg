'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
	Attachment,
	AttachmentContent,
	AttachmentDescription,
	AttachmentMedia,
	AttachmentTitle,
	AttachmentTrigger,
} from '@/components/ui/attachment';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldGroup } from '@/components/ui/field';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import { formatRelativeTime, formatTimeFull } from '@/core/utils/time';
import { buildPinnwandPrefill, getPinnwandPrefillHref } from '@/features/pinnwand/pinnwand-prefill';
import { cn } from '@/shared/lib/cn';
import {
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Eye,
	Hand,
	ListChecks,
	MessageCircle,
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
import { type ReactElement, memo, useEffect, useRef, useState } from 'react';
import type {
	Announcement,
	AnnouncementComment,
	AnnouncementKind,
	AnnouncementSource,
	ReactionKey,
} from './announcement-types';
import { KIND_LABELS } from './constants';

interface AnnouncementCardProps {
	announcement: Announcement;
	author: { name: string; color: string | null };
	deletePending: boolean;
	pinPending: boolean;
	statusPending: boolean;
	reactionPending: (reaction: ReactionKey) => boolean;
	onDelete: () => Promise<boolean>;
	onTogglePinned: () => void;
	onToggleStatus: () => void;
	onToggleReaction: (reaction: ReactionKey) => void;
	onAddComment: (content: string) => Promise<boolean>;
	onUpdateComment: (commentId: string, content: string) => Promise<boolean>;
	onDeleteComment: (commentId: string) => Promise<boolean>;
	currentMemberId: string;
	isAdmin: boolean;
	shareCode: string;
	highlighted: boolean;
}

const SOURCE_LABELS: Record<AnnouncementSource, string | null> = {
	manual: null,
	system: 'System',
	chore_swap: 'Putzplan',
	expense: 'Ausgaben',
	shopping: 'Einkauf',
};
const REACTIONS = [
	{ key: 'seen', label: 'Gesehen', icon: Eye },
	{ key: 'take', label: 'Übernehme ich', icon: Hand },
	{ key: 'ok', label: 'Passt', icon: ThumbsUp },
] as const;
const PRIMARY_REACTION: Record<AnnouncementKind, ReactionKey> = {
	info: 'seen',
	question: 'seen',
	problem: 'take',
	request: 'take',
	decision: 'ok',
};

function actionLabelSubject(value: string, fallback: string): string {
	const normalized = value.trim().replace(/\s+/g, ' ');
	return normalized.length > 48 ? `${normalized.slice(0, 47)}…` : normalized || fallback;
}

// Comment input survives hiding a thread, filtering a card, and route changes.
// Keys include the household, member and post/comment; no shared draft context.
function useCommentDraft(key: string, initial = '') {
	const [draft, setDraft] = useState(initial);
	const [restored, setRestored] = useState(false);
	useEffect(() => {
		const saved = readDraft<{ content?: string }>(key);
		if (typeof saved?.content === 'string' && saved.content.length > 0) {
			setDraft(saved.content);
			setRestored(true);
		}
	}, [key]);
	function change(value: string) {
		setDraft(value);
		setRestored(Boolean(value));
		if (value) writeDraft(key, { content: value });
		else removeDraft(key);
	}
	function clear() {
		setDraft('');
		setRestored(false);
		removeDraft(key);
	}
	return { draft, change, clear, restored };
}

export const AnnouncementCard = memo(function AnnouncementCard({
	announcement,
	author,
	deletePending,
	pinPending,
	statusPending,
	reactionPending,
	onDelete,
	onTogglePinned,
	onToggleStatus,
	onToggleReaction,
	onAddComment,
	onUpdateComment,
	onDeleteComment,
	currentMemberId,
	isAdmin,
	shareCode,
	highlighted,
}: AnnouncementCardProps): ReactElement {
	const bodyText = announcement.content.trim();
	const isLong = bodyText.length > 300 || bodyText.split('\n').length > 6;
	const [expanded, setExpanded] = useState(false);
	const [commentsOpen, setCommentsOpen] = useState(false);
	const [commentPending, setCommentPending] = useState(false);
	const [commentError, setCommentError] = useState(false);
	const commentPendingRef = useRef(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleteError, setDeleteError] = useState(false);
	const [touchedReactions, setTouchedReactions] = useState<ReactionKey[]>([]);
	const draftKey = `manawg:draft:${shareCode}:${currentMemberId}:announcement:${announcement.id}`;
	const commentDraft = useCommentDraft(`${draftKey}:reply`);
	useEffect(() => {
		if (commentDraft.restored) setCommentsOpen(true);
	}, [commentDraft.restored]);

	const isResolved = announcement.status === 'resolved';
	const isPinned = Boolean(announcement.pinnedAt);
	const isAuthor = announcement.authorMemberId === currentMemberId;
	const canModerate = isAuthor || isAdmin;
	const canResolve = isAuthor || announcement.myReactions.includes('take');
	const sourceLabel = SOURCE_LABELS[announcement.source];
	const sourceHref = announcement.sourcePath
		? `/wg/${encodeURIComponent(shareCode)}${announcement.sourcePath}`
		: null;
	const actionSubject = actionLabelSubject(bodyText, 'leerer Beitrag');
	const takerNames = announcement.takers.map((taker) => taker.name);
	const prefill = buildPinnwandPrefill(bodyText);
	const conversionTargets =
		announcement.source === 'manual'
			? ([
					{ target: 'shopping', label: 'Als Einkauf', icon: ListChecks },
					{ target: 'chore', label: 'Als Aufgabe', icon: Sparkles },
					{ target: 'expense', label: 'Als Ausgabe', icon: Receipt },
				] as const)
			: [];
	const reactionOptions = isResolved ? REACTIONS.filter(({ key }) => key !== 'take') : REACTIONS;
	const visibleReactions = reactionOptions.filter(
		({ key }) =>
			key === PRIMARY_REACTION[announcement.kind] ||
			announcement.myReactions.includes(key) ||
			touchedReactions.includes(key) ||
			(announcement.reactionCounts[key] ?? 0) > 0,
	);
	const hiddenReactions = reactionOptions.filter(
		({ key }) => !visibleReactions.some((reaction) => reaction.key === key),
	);
	const busy =
		deletePending ||
		pinPending ||
		statusPending ||
		REACTIONS.some(({ key }) => reactionPending(key));

	function react(key: ReactionKey) {
		setTouchedReactions((current) => (current.includes(key) ? current : [...current, key]));
		onToggleReaction(key);
	}
	async function submitComment() {
		const text = commentDraft.draft.trim();
		if (!text || commentPendingRef.current) return;
		commentPendingRef.current = true;
		setCommentPending(true);
		setCommentError(false);
		try {
			const ok = await onAddComment(text);
			if (ok) commentDraft.clear();
			else setCommentError(true);
		} finally {
			commentPendingRef.current = false;
			setCommentPending(false);
		}
	}

	return (
		<li
			id={`announcement-${announcement.id}`}
			className={cn(
				'scroll-mt-24 rounded-xl',
				highlighted && 'outline outline-2 outline-offset-4 outline-ring',
			)}
		>
			<Card aria-busy={busy}>
				<CardHeader>
					<CardTitle className="flex min-w-0 items-center gap-2">
						<Avatar>
							<AvatarFallback>{author.name.slice(0, 2).toLocaleUpperCase('de-DE')}</AvatarFallback>
						</Avatar>
						<span className="min-w-0 break-words">{author.name}</span>
					</CardTitle>
					<CardDescription className="flex flex-wrap items-center gap-2">
						<time dateTime={announcement.createdAt} title={formatTimeFull(announcement.createdAt)}>
							{formatRelativeTime(announcement.createdAt)}
						</time>
						{sourceLabel && <span>· {sourceLabel}</span>}
					</CardDescription>
					<CardAction>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={<Button variant="ghost" size="icon" />}
								aria-label={`Beitragsaktionen: ${actionSubject}`}
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
											aria-label={`Quelle öffnen: ${actionSubject}`}
										>
											<ExternalLink aria-hidden /> Quelle öffnen
										</DropdownMenuItem>
									)}
									{conversionTargets.map(({ target, label, icon: Icon }) => (
										<DropdownMenuItem
											key={target}
											render={<Link href={getPinnwandPrefillHref(shareCode, target, prefill)} />}
											className="min-h-11"
											aria-label={`${label} übernehmen: ${actionSubject}`}
										>
											<Icon aria-hidden /> {label} übernehmen
										</DropdownMenuItem>
									))}
									{hiddenReactions.map(({ key, label, icon: Icon }) => (
										<DropdownMenuItem
											key={key}
											onClick={() => react(key)}
											disabled={reactionPending(key)}
											className="min-h-11"
											aria-label={`${label}-Reaktion setzen: ${actionSubject}`}
										>
											<Icon aria-hidden /> {label}
										</DropdownMenuItem>
									))}
								</DropdownMenuGroup>
								{(canModerate || canResolve) && <DropdownMenuSeparator />}
								<DropdownMenuGroup>
									{canModerate && (
										<DropdownMenuItem
											onClick={onTogglePinned}
											disabled={pinPending}
											className="min-h-11"
											aria-label={
												(isPinned ? 'Fixierung lösen: ' : 'Beitrag fixieren: ') + actionSubject
											}
										>
											{pinPending ? <Spinner /> : isPinned ? <PinOff /> : <Pin />}
											{isPinned ? 'Fixierung lösen' : 'Fixieren'}
										</DropdownMenuItem>
									)}
									{canResolve && (
										<DropdownMenuItem
											onClick={onToggleStatus}
											disabled={statusPending}
											className="min-h-11"
											aria-label={
												(isResolved ? 'Beitrag wieder öffnen: ' : 'Als geklärt markieren: ') +
												actionSubject
											}
										>
											{statusPending ? <Spinner /> : <CheckCircle2 />}
											{isResolved ? 'Wieder öffnen' : 'Als geklärt markieren'}
										</DropdownMenuItem>
									)}
									{canModerate && (
										<DropdownMenuItem
											variant="destructive"
											onClick={() => {
												setDeleteError(false);
												setDeleteOpen(true);
											}}
											className="min-h-11"
											aria-label={`Beitrag entfernen: ${actionSubject}`}
										>
											<Trash2 /> Entfernen
										</DropdownMenuItem>
									)}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</CardAction>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="outline">{KIND_LABELS[announcement.kind]}</Badge>
						{isPinned && (
							<Badge variant="secondary">
								<Pin aria-hidden /> Fixiert
							</Badge>
						)}
						<Badge variant={isResolved ? 'secondary' : 'outline'}>
							{isResolved ? <CheckCircle2 aria-hidden /> : null}
							{isResolved ? 'Geklärt' : takerNames.length > 0 ? 'Übernommen' : 'Offen'}
						</Badge>
						{busy && (
							<output className="flex items-center gap-1 text-xs text-muted-foreground">
								<Spinner /> Wird gespeichert…
							</output>
						)}
					</div>
					{bodyText && (
						<div className="flex flex-col items-start gap-1">
							<p
								id={`announcement-body-${announcement.id}`}
								className={cn(
									'text-base whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]',
									isLong && !expanded && 'line-clamp-3',
								)}
							>
								{bodyText}
							</p>
							{isLong && (
								<Button
									variant="ghost"
									onClick={() => setExpanded((value) => !value)}
									aria-expanded={expanded}
									aria-controls={`announcement-body-${announcement.id}`}
									aria-label={(expanded ? 'Weniger anzeigen: ' : 'Mehr anzeigen: ') + actionSubject}
								>
									{expanded ? (
										<ChevronUp data-icon="inline-start" />
									) : (
										<ChevronDown data-icon="inline-start" />
									)}
									{expanded ? 'Weniger' : 'Mehr anzeigen'}
								</Button>
							)}
						</div>
					)}
					{announcement.imageUrl && (
						<Attachment state="done" className="w-full">
							<AttachmentMedia variant="image" className="size-20">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={announcement.imageUrl}
									alt={`Bildanhang: ${actionSubject}`}
									loading="lazy"
								/>
							</AttachmentMedia>
							<AttachmentContent>
								<AttachmentTitle>Beitragsbild</AttachmentTitle>
								<AttachmentDescription>In voller Größe öffnen</AttachmentDescription>
							</AttachmentContent>
							<AttachmentTrigger
								aria-label={`Bildanhang öffnen: ${actionSubject}`}
								render={
									<a href={announcement.imageUrl} target="_blank" rel="noopener noreferrer">
										<span className="sr-only">Bildanhang öffnen: {actionSubject}</span>
									</a>
								}
							/>
						</Attachment>
					)}
					{takerNames.length > 0 && (
						<div className="flex items-start gap-2 text-sm">
							<Hand className="mt-0.5 size-4 shrink-0" aria-hidden />
							<p className="min-w-0 [overflow-wrap:anywhere]">
								{takerNames.join(', ')} {takerNames.length === 1 ? 'übernimmt' : 'übernehmen'}
							</p>
						</div>
					)}
					{announcement.resolvedAt && (
						<p className="text-xs text-muted-foreground">
							Geklärt {formatRelativeTime(announcement.resolvedAt)}
						</p>
					)}
				</CardContent>
				<CardFooter className="flex-col items-stretch gap-3">
					<Collapsible
						open={commentsOpen}
						onOpenChange={setCommentsOpen}
						className="flex flex-col gap-3"
					>
						<div className="flex flex-wrap gap-2">
							{visibleReactions.map(({ key, label, icon: Icon }) => {
								const active = announcement.myReactions.includes(key);
								const count = announcement.reactionCounts[key] ?? 0;
								return (
									<Button
										key={key}
										variant={active ? 'secondary' : 'outline'}
										onClick={() => react(key)}
										disabled={reactionPending(key)}
										aria-pressed={active}
										aria-label={
											label +
											(active ? '-Reaktion entfernen: ' : '-Reaktion setzen: ') +
											actionSubject
										}
									>
										{reactionPending(key) ? (
											<Spinner data-icon="inline-start" />
										) : (
											<Icon data-icon="inline-start" />
										)}
										{key === 'take' && count > 0 ? (active ? 'Mein Task' : 'Übernommen') : label}
										{count > 0 && <span className="tabular-nums">{count}</span>}
									</Button>
								);
							})}
							{!isResolved && takerNames.length > 0 && canResolve && (
								<Button
									variant="outline"
									disabled={statusPending}
									onClick={onToggleStatus}
									aria-label={`Als erledigt markieren: ${actionSubject}`}
								>
									{statusPending ? (
										<Spinner data-icon="inline-start" />
									) : (
										<CheckCircle2 data-icon="inline-start" />
									)}{' '}
									Erledigt
								</Button>
							)}
							{isResolved && isPinned && canModerate && (
								<Button
									variant="outline"
									disabled={pinPending}
									onClick={onTogglePinned}
									aria-label={`Fixierung lösen: ${actionSubject}`}
								>
									<PinOff data-icon="inline-start" /> Pin lösen
								</Button>
							)}
							{isResolved && !announcement.myReactions.includes('ok') && (
								<Button
									variant="outline"
									disabled={reactionPending('ok')}
									onClick={() => react('ok')}
									aria-label={`Danke-Reaktion setzen: ${actionSubject}`}
								>
									<ThumbsUp data-icon="inline-start" /> Danke
								</Button>
							)}
							<CollapsibleTrigger
								render={<Button variant="ghost" />}
								aria-label={`Antworten anzeigen: ${actionSubject}`}
								aria-controls={`announcement-comments-${announcement.id}`}
							>
								<MessageCircle data-icon="inline-start" /> Antworten
								{announcement.comments.length > 0 && (
									<span className="tabular-nums">{announcement.comments.length}</span>
								)}
							</CollapsibleTrigger>
						</div>
						<CollapsiblePanel
							keepRendered
							inert={!commentsOpen}
							id={`announcement-comments-${announcement.id}`}
						>
							<div className="flex flex-col gap-3">
								<Separator />
								{announcement.comments.length > 0 && (
									<ul className="flex flex-col gap-4">
										{announcement.comments.map((comment) => (
											<CommentRow
												key={comment.id}
												comment={comment}
												canEdit={
													comment.memberId === currentMemberId && !comment.id.startsWith('temp-')
												}
												draftKey={`${draftKey}:edit:${comment.id}`}
												onUpdate={(text) => onUpdateComment(comment.id, text)}
												onDelete={() => onDeleteComment(comment.id)}
											/>
										))}
									</ul>
								)}
								{commentError && (
									<Alert id={`announcement-comment-error-${announcement.id}`} variant="destructive">
										<AlertDescription>
											Antwort nicht gespeichert. Dein Text bleibt zum erneuten Senden erhalten.
										</AlertDescription>
									</Alert>
								)}
								<Field data-invalid={commentError}>
									<InputGroup>
										<InputGroupTextarea
											value={commentDraft.draft}
											onChange={(event) => commentDraft.change(event.target.value)}
											disabled={commentPending}
											aria-invalid={commentError}
											aria-describedby={
												commentError ? `announcement-comment-error-${announcement.id}` : undefined
											}
											maxLength={600}
											rows={2}
											aria-label={`Antwort verfassen: ${actionSubject}`}
											placeholder="Antwort schreiben"
											className="max-h-40 text-base"
										/>
										<InputGroupAddon align="block-end" className="justify-end">
											<InputGroupButton
												variant="default"
												size="sm"
												className="min-h-11"
												disabled={commentPending || !commentDraft.draft.trim()}
												onClick={() => void submitComment()}
												aria-label={`Antwort senden: ${actionSubject}`}
											>
												{commentPending ? (
													<Spinner data-icon="inline-start" />
												) : (
													<Send data-icon="inline-start" />
												)}
												{commentPending ? 'Wird gesendet…' : 'Antworten'}
											</InputGroupButton>
										</InputGroupAddon>
									</InputGroup>
								</Field>
							</div>
						</CollapsiblePanel>
					</Collapsible>
				</CardFooter>
			</Card>
			<AlertDialog
				open={deleteOpen}
				onOpenChange={(open) => {
					if (!deletePending) setDeleteOpen(open);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Beitrag entfernen?</AlertDialogTitle>
						<AlertDialogDescription>
							„{actionSubject}“ und die zugehörigen Antworten werden entfernt.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deleteError && (
						<Alert variant="destructive">
							<AlertDescription>
								Beitrag konnte nicht entfernt werden. Versuche es erneut.
							</AlertDescription>
						</Alert>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deletePending} className="min-h-11">
							Abbrechen
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deletePending}
							className="min-h-11"
							aria-label={`Beitrag entfernen bestätigen: ${actionSubject}`}
							onClick={async () => {
								setDeleteError(false);
								const ok = await onDelete();
								if (ok) setDeleteOpen(false);
								else setDeleteError(true);
							}}
						>
							{deletePending && <Spinner data-icon="inline-start" />}
							{deletePending ? 'Wird entfernt…' : 'Entfernen'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</li>
	);
});

function CommentRow({
	comment,
	canEdit,
	draftKey,
	onUpdate,
	onDelete,
}: {
	comment: AnnouncementComment;
	canEdit: boolean;
	draftKey: string;
	onUpdate: (content: string) => Promise<boolean>;
	onDelete: () => Promise<boolean>;
}): ReactElement {
	const [editing, setEditing] = useState(false);
	const draft = useCommentDraft(draftKey, comment.content);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const focusEditorOnEditRef = useRef(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState(false);
	const pendingRef = useRef(false);
	const actionSubject = actionLabelSubject(comment.content, 'leerer Kommentar');
	useEffect(() => {
		if (draft.restored && canEdit) setEditing(true);
	}, [draft.restored, canEdit]);
	useEffect(() => {
		if (!editing || !focusEditorOnEditRef.current) return;
		focusEditorOnEditRef.current = false;
		editorRef.current?.focus();
	}, [editing]);
	async function save() {
		if (!draft.draft.trim() || pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(false);
		try {
			if (await onUpdate(draft.draft.trim())) {
				draft.clear();
				setEditing(false);
			} else setError(true);
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	}
	async function remove() {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(false);
		try {
			if (!(await onDelete())) setError(true);
			else draft.clear();
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	}
	return (
		<li className="flex min-w-0 gap-2" aria-busy={pending || comment.id.startsWith('temp-')}>
			<Avatar size="sm">
				<AvatarFallback>
					{(comment.authorName || '?').slice(0, 2).toLocaleUpperCase('de-DE')}
				</AvatarFallback>
			</Avatar>
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium">{comment.authorName || 'Unbekannt'}</span>
					<time
						dateTime={comment.createdAt}
						title={formatTimeFull(comment.createdAt)}
						className="text-xs text-muted-foreground"
					>
						{formatRelativeTime(comment.createdAt)}
					</time>
					{comment.id.startsWith('temp-') && (
						<Badge variant="outline">
							<Spinner /> Wird gesendet…
						</Badge>
					)}
				</div>
				{editing ? (
					<FieldGroup className="gap-2">
						<Field data-invalid={error}>
							<Textarea
								ref={editorRef}
								value={draft.draft}
								onChange={(event) => draft.change(event.target.value)}
								disabled={pending}
								maxLength={600}
								rows={2}
								aria-label="Kommentar bearbeiten"
								aria-invalid={error}
								aria-describedby={error ? `comment-edit-error-${comment.id}` : undefined}
								className="text-base"
							/>
						</Field>
						<div className="flex flex-wrap justify-end gap-2">
							<Button variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
								Später
							</Button>
							<Button
								disabled={pending || !draft.draft.trim()}
								onClick={() => void save()}
								aria-label={`Kommentar speichern: ${actionSubject}`}
							>
								{pending && <Spinner data-icon="inline-start" />}{' '}
								{pending ? 'Wird gespeichert…' : 'Speichern'}
							</Button>
						</div>
					</FieldGroup>
				) : (
					<p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{comment.content}</p>
				)}
				{error && (
					<Alert id={`comment-edit-error-${comment.id}`} variant="destructive">
						<AlertDescription>
							Kommentar konnte nicht gespeichert oder entfernt werden. Versuche es erneut.
						</AlertDescription>
					</Alert>
				)}
				{canEdit && !editing && (
					<div className="flex gap-1">
						<Button
							variant="ghost"
							size="sm"
							disabled={pending}
							aria-label={`Kommentar bearbeiten: ${actionSubject}`}
							onClick={() => {
								if (!draft.restored) draft.change(comment.content);
								focusEditorOnEditRef.current = true;
								setEditing(true);
							}}
						>
							<Pencil data-icon="inline-start" /> Bearbeiten
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={pending}
							aria-label={`Kommentar entfernen: ${actionSubject}`}
							onClick={() => void remove()}
						>
							{pending ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}{' '}
							Entfernen
						</Button>
					</div>
				)}
			</div>
		</li>
	);
}
