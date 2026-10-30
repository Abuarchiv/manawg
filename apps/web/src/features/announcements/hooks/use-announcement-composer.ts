import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { buildDraftKey, readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import {
	enqueueOfflineAction,
	isOfflineActionQueued,
	removeQueuedAction,
} from '@/core/offline/offline-client';
import { createQueuedAnnouncement } from '@/core/offline/offline-queue';
import { resolveSubmitImage } from '@/core/offline/resolve-submit-image';
import { announcementCreateError } from '@/features/announcements/announcement-errors';
import { deliveryWarning } from '@/features/announcements/announcement-warning';
import { ANNOUNCEMENT_KINDS } from '@/features/announcements/announcement-workflow';
import type { AnnouncementKind } from '@/features/announcements/components/announcement-types';
import { CONTENT_MAX } from '@/features/announcements/constants';
import { type Message, useMessage } from '@/shared/i18n/message';
import type {
	AnnouncementPageContext,
	AnnouncementWriteResponse,
} from './announcement-page-context';

function kindFromParam(value: string | null): AnnouncementKind | null {
	return ANNOUNCEMENT_KINDS.find((kind) => kind === value) ?? null;
}

/** Compose a post: composer state, localStorage draft, prefill from the URL and creation (online/offline). */
export function useAnnouncementComposer(
	ctx: AnnouncementPageContext,
	scrollToAnnouncement: (id: string, behavior?: ScrollBehavior) => void,
) {
	const { wg, identity, encodedShareCode, setNotice, load, refreshCount } = ctx;
	const toast = useToast();
	const render = useMessage();
	const searchParams = useSearchParams();
	const prefillContent = searchParams.get('content');
	const prefillKind = kindFromParam(searchParams.get('kind'));
	const prefillImageUrl = searchParams.get('imageUrl');
	const [content, setContent] = useState('');
	const [kind, setKind] = useState<AnnouncementKind>('info');
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const announcementIdempotencyKeyRef = useRef<PendingIdempotentRequest | null>(null);
	const [error, setError] = useState<Message | null>(null);
	const [composerOpen, setComposerOpen] = useState(false);
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const [draftHydrated, setDraftHydrated] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const appliedPrefillRef = useRef<string | null>(null);
	const draftKey = buildDraftKey(wg.shareCode, identity.memberId, 'announcement');
	const prefillKey = `${prefillContent ?? ''}|${prefillKind ?? ''}|${prefillImageUrl ?? ''}`;
	const hasDraft = Boolean(content.trim() || imageUrl || queueEditId);

	const createButtonRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		if (!composerOpen) return;
		function onKey(e: KeyboardEvent): void {
			if (e.key === 'Escape' && content.length === 0 && !imageUrl) {
				setComposerOpen(false);
				setError(null);
				setNotice(null);
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [composerOpen, content, imageUrl, setNotice]);

	// On send error: focus back into the text field (the disabled send button took it away).
	useEffect(() => {
		if (error && composerOpen && document.activeElement === document.body) {
			textareaRef.current?.focus({ preventScroll: true });
		}
	}, [error, composerOpen]);

	function closeComposer(): void {
		if (submittingRef.current) return;
		setComposerOpen(false);
		setError(null);
		setNotice(null);
	}

	useEffect(() => {
		if (prefillContent || prefillKind || prefillImageUrl) {
			setDraftHydrated(true);
			return;
		}
		const draft = readDraft<{
			content?: string;
			kind?: AnnouncementKind;
			imageUrl?: string | null;
			queueEditId?: string;
		}>(draftKey);
		if (!draft) {
			setDraftHydrated(true);
			return;
		}
		if (draft?.content) {
			setContent(draft.content);
		}
		if (draft?.kind) setKind(draft.kind);
		if (draft && 'imageUrl' in draft) setImageUrl(draft.imageUrl ?? null);
		if (draft?.queueEditId) {
			setQueueEditId(draft.queueEditId);
		}
		setDraftHydrated(true);
	}, [draftKey, prefillContent, prefillImageUrl, prefillKind]);

	useEffect(() => {
		if (!prefillContent && !prefillKind && !prefillImageUrl) return;
		if (appliedPrefillRef.current === prefillKey) return;
		appliedPrefillRef.current = prefillKey;
		if (prefillContent) setContent(prefillContent.slice(0, CONTENT_MAX));
		if (prefillKind) setKind(prefillKind);
		if (prefillImageUrl) setImageUrl(prefillImageUrl);
		setComposerOpen(true);
		// Take the prefill only once: otherwise the composer reopens after cancel and reload.
		const url = new URL(window.location.href);
		for (const name of ['content', 'kind', 'imageUrl']) url.searchParams.delete(name);
		window.history.replaceState(window.history.state, '', url);
	}, [prefillContent, prefillImageUrl, prefillKey, prefillKind]);

	useEffect(() => {
		if (!draftHydrated) return;
		writeDraft(draftKey, { content, kind, imageUrl, queueEditId });
	}, [content, draftHydrated, draftKey, imageUrl, kind, queueEditId]);

	async function clearEditedQueueItem(): Promise<boolean> {
		if (!queueEditId) return true;
		if (!(await removeQueuedAction(queueEditId))) return false;
		setQueueEditId(null);
		return true;
	}

	async function submit(): Promise<void> {
		const text = content.trim();
		if (text.length === 0 || text.length > CONTENT_MAX) {
			setError(announcementCreateError('content_invalid'));
			return;
		}
		if (submittingRef.current) return;
		// The edited queue entry may have been synced meanwhile; a new create would duplicate it.
		if (queueEditId && !isOfflineActionQueued(queueEditId)) {
			setQueueEditId(null);
			setContent('');
			setKind('info');
			setImageUrl(null);
			setComposerOpen(false);
			removeDraft(draftKey);
			setError(null);
			setNotice({ key: 'pinboard.errors.queueEditAlreadySent' });
			void load();
			return;
		}
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		setError(null);
		setNotice(null);
		// A pending image token from a failed upload is retried here; offline it stays for the replay.
		const image = await resolveSubmitImage(imageUrl, identity.memberId, navigator.onLine);
		if (!image) {
			setError({ key: 'pinboard.errors.imageUploadFailed' });
			setSubmitting(false);
			submittingRef.current = false;
			return;
		}
		const finalImageUrl = image.url;
		if (finalImageUrl !== imageUrl) setImageUrl(finalImageUrl);
		const fingerprint = JSON.stringify({ text, imageUrl: finalImageUrl, kind });
		const idempotencyKey = resolveIdempotencyKey(
			announcementIdempotencyKeyRef.current,
			fingerprint,
		);
		if (!idempotencyKey) {
			setError({ key: 'pinboard.errors.postKeyUnavailable' });
			setSubmitting(false);
			submittingRef.current = false;
			return;
		}
		announcementIdempotencyKeyRef.current = { fingerprint, key: idempotencyKey };
		try {
			const res = await apiFetch<AnnouncementWriteResponse>(
				`/api/wg/${encodedShareCode}/announcements`,
				{
					method: 'POST',
					memberId: identity.memberId,
					headers: { 'Idempotency-Key': idempotencyKey },
					body: JSON.stringify({
						content: text,
						imageUrl: finalImageUrl,
						kind,
					}),
				},
			);
			if (!res.ok) {
				if (shouldReleaseIdempotencyKey(res.status, res.error)) {
					announcementIdempotencyKeyRef.current = null;
				}
				if (res.status === 0) {
					const queued = createQueuedAnnouncement({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						idempotencyKey,
						content: text,
						kind,
						imageUrl: finalImageUrl,
					});
					if ((await enqueueOfflineAction(queued)) === 0) {
						setError({ key: 'pinboard.errors.queueBlocked' });
						return;
					}
					announcementIdempotencyKeyRef.current = null;
					refreshCount();
					if (!(await clearEditedQueueItem())) {
						setError({ key: 'pinboard.errors.draftCleanupFailedOffline' });
						return;
					}
					setContent('');
					setKind('info');
					setImageUrl(null);
					setComposerOpen(false);
					removeDraft(draftKey);
					setNotice({ key: 'pinboard.notices.savedOffline' });
					return;
				}
				setError(announcementCreateError(res.error));
				return;
			}
			const createdAnnouncementId = res.data.announcement.id;
			announcementIdempotencyKeyRef.current = null;
			setContent('');
			setKind('info');
			setImageUrl(null);
			if (!(await clearEditedQueueItem())) {
				setError({ key: 'pinboard.errors.draftCleanupFailed' });
				return;
			}
			removeDraft(draftKey);
			setComposerOpen(false);
			const warning = deliveryWarning(res.data.warning);
			if (warning) toast.info(render(warning));
			else toast.success(render({ key: 'pinboard.notices.published' }));
			void load().then(() => scrollToAnnouncement(createdAnnouncementId));
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	}

	return {
		open: composerOpen,
		setOpen: setComposerOpen,
		buttonRef: createButtonRef,
		textareaRef,
		submitting,
		hasDraft,
		kind,
		setKind,
		content,
		setContent,
		imageUrl,
		setImageUrl,
		error,
		close: closeComposer,
		submit,
	};
}
