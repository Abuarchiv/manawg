'use client';
import { Pencil, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactElement, useEffect, useRef, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { Field, FieldGroup } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import { formatTimeFull, relativeTimeMessage } from '@/core/utils/time';
import { isRestorableDraft } from '@/features/pinnwand/announcement-edits';
import { COMMENT_MAX } from '@/features/pinnwand/constants';
import type { Locale } from '@/shared/i18n/locale';
import { useMessage } from '@/shared/i18n/message';
import type { AnnouncementComment } from './announcement-types';

export function actionLabelSubject(value: string, fallback: string): string {
	const normalized = value.trim().replace(/\s+/g, ' ');
	return normalized.length > 48
		? `${normalized.slice(0, 47).replace(/[\s,;:.–-]+$/, '')}…`
		: normalized || fallback;
}

// Comment input survives hiding a thread, filtering a card, and route changes.
// Keys include the household, member and post/comment; no shared draft context.
export function useCommentDraft(key: string, initial = '') {
	const [draft, setDraft] = useState(initial);
	const [restored, setRestored] = useState(false);
	useEffect(() => {
		const saved = readDraft<{ content?: string }>(key);
		if (isRestorableDraft(saved, initial)) {
			setDraft(saved.content);
			setRestored(true);
		} else if (saved) removeDraft(key);
	}, [key, initial]);
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

export function CommentRow({
	comment,
	canEdit,
	canDelete,
	draftKey,
	onUpdate,
	onDelete,
}: {
	comment: AnnouncementComment;
	canEdit: boolean;
	/** Own replies, or any reply for the WG admin. */
	canDelete: boolean;
	draftKey: string;
	onUpdate: (content: string) => Promise<boolean>;
	onDelete: () => Promise<boolean>;
}): ReactElement {
	const t = useTranslations('pinnwand');
	const tCommon = useTranslations('common');
	const render = useMessage();
	const locale = useLocale() as Locale;
	const [editing, setEditing] = useState(false);
	const draft = useCommentDraft(draftKey, comment.content);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const focusEditorOnEditRef = useRef(false);
	const editButtonRef = useRef<HTMLButtonElement>(null);
	const focusEditButtonRef = useRef(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const pendingRef = useRef(false);
	const actionSubject = actionLabelSubject(comment.content, t('subject.emptyReply'));
	useEffect(() => {
		if (draft.restored && canEdit) setEditing(true);
	}, [draft.restored, canEdit]);
	useEffect(() => {
		if (!editing || !focusEditorOnEditRef.current) return;
		focusEditorOnEditRef.current = false;
		editorRef.current?.focus();
	}, [editing]);
	// After save/cancel the editor is gone: return focus to the edit button.
	useEffect(() => {
		if (editing || pending || !focusEditButtonRef.current) return;
		focusEditButtonRef.current = false;
		editButtonRef.current?.focus();
	}, [editing, pending]);
	async function save() {
		if (!draft.draft.trim() || pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(false);
		try {
			if (await onUpdate(draft.draft.trim())) {
				draft.clear();
				focusEditButtonRef.current = true;
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
			else {
				draft.clear();
				setConfirmOpen(false);
			}
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	}
	return (
		<li className="flex min-w-0 gap-2" aria-busy={pending || comment.id.startsWith('temp-')}>
			<MemberAvatar name={comment.authorName || '?'} size={24} />
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
						{comment.authorName || tCommon('unknownPerson')}
					</span>
					<time
						dateTime={comment.createdAt}
						title={formatTimeFull(comment.createdAt, locale)}
						className="text-xs text-muted-foreground"
					>
						{render(relativeTimeMessage(comment.createdAt, Date.now(), locale))}
					</time>
					{comment.id.startsWith('temp-') && (
						<output className="inline-flex items-center gap-1 text-xs text-muted-foreground">
							<Spinner /> {t('comment.sending')}
						</output>
					)}
					{(canEdit || canDelete) && !editing && (
						<span className="ml-auto flex gap-1">
							{canEdit && (
								<Button
									ref={editButtonRef}
									variant="ghost"
									size="icon-sm"
									disabled={pending}
									aria-label={t('comment.editAria', { subject: actionSubject })}
									onClick={() => {
										if (!draft.restored) draft.change(comment.content);
										focusEditorOnEditRef.current = true;
										setEditing(true);
									}}
								>
									<Pencil aria-hidden />
								</Button>
							)}
							{canDelete && (
								<Button
									variant="ghost"
									size="icon-sm"
									disabled={pending}
									aria-label={t('comment.removeAria', { subject: actionSubject })}
									onClick={() => {
										setError(false);
										setConfirmOpen(true);
									}}
								>
									<Trash2 aria-hidden />
								</Button>
							)}
						</span>
					)}
				</div>
				{editing ? (
					<FieldGroup className="gap-2">
						<Field data-invalid={error} className="data-[invalid=true]:text-foreground">
							<Textarea
								ref={editorRef}
								value={draft.draft}
								onChange={(event) => draft.change(event.target.value)}
								readOnly={pending}
								aria-busy={pending}
								maxLength={COMMENT_MAX}
								rows={2}
								aria-label={t('comment.editorAria')}
								aria-invalid={error}
								aria-describedby={error ? `comment-edit-error-${comment.id}` : undefined}
								className="text-base read-only:opacity-60"
							/>
						</Field>
						<div className="flex flex-wrap justify-end gap-2">
							<Button
								variant="ghost"
								disabled={pending}
								onClick={() => {
									// Drop the draft so the next edit starts from the current comment text.
									draft.clear();
									focusEditButtonRef.current = true;
									setEditing(false);
								}}
							>
								{t('comment.cancel')}
							</Button>
							<Button
								disabled={pending || !draft.draft.trim()}
								onClick={() => void save()}
								aria-label={t('comment.saveAria', { subject: actionSubject })}
							>
								{pending && <Spinner data-icon="inline-start" />}{' '}
								{pending ? t('comment.saving') : t('comment.save')}
							</Button>
						</div>
					</FieldGroup>
				) : (
					<p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{comment.content}</p>
				)}
				{error && editing && (
					<Alert id={`comment-edit-error-${comment.id}`} variant="destructive">
						<AlertDescription>{t('comment.saveFailed')}</AlertDescription>
					</Alert>
				)}
			</div>
			<AlertDialog
				open={confirmOpen}
				onOpenChange={(open) => {
					// pendingRef locks synchronously: the built-in close runs before the next render.
					if (pendingRef.current || pending) return;
					setConfirmOpen(open);
					if (!open) setError(false);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('comment.removeTitle')}</AlertDialogTitle>
						<AlertDialogDescription>
							{t('comment.removeBody', {
								own: canEdit ? 'yes' : 'other',
								author: comment.authorName || tCommon('unknownPerson'),
								subject: actionSubject,
							})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					{error && (
						<Alert variant="destructive">
							<AlertDescription>{t('comment.removeFailed')}</AlertDescription>
						</Alert>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending} className="min-h-11">
							{t('comment.cancel')}
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={pending}
							className="min-h-11"
							aria-label={t('comment.removeConfirmAria', { subject: actionSubject })}
							onClick={() => void remove()}
						>
							{pending && <Spinner data-icon="inline-start" />}
							{pending ? t('comment.removing') : t('comment.remove')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</li>
	);
}
