import { type MutableRefObject, useRef } from 'react';
import { mutationError } from '@/core/http/error-codes';
import { createIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { withToggledReaction } from '@/features/pinnwand/announcement-edits';
import { announcementActionError } from '@/features/pinnwand/announcement-errors';
import { deliveryWarning } from '@/features/pinnwand/announcement-warning';
import type { CommentOverrides } from '@/features/pinnwand/comment-overrides';
import type {
	Announcement,
	AnnouncementKind,
	AnnouncementStatus,
	ReactionKey,
} from '@/features/pinnwand/components/announcement-types';
import { type Message, useMessage } from '@/shared/i18n/message';
import { announcementListEdits } from './announcement-list-edits';
import type {
	AnnouncementPageContext,
	AnnouncementReactionResponse,
	AnnouncementWriteResponse,
} from './announcement-page-context';
import { useAnnouncementComments } from './use-announcement-comments';

/** Pinnwand cards: pin, status, reactions, replies and delete, each with an optimistic update. */
export function useAnnouncementActions(
	ctx: AnnouncementPageContext,
	commentOverridesRef: MutableRefObject<CommentOverrides>,
) {
	const {
		identity,
		members,
		toast,
		encodedShareCode,
		isPending,
		start,
		end,
		setActionError,
		itemsRef,
		commitItems,
		load,
	} = ctx;
	const render = useMessage();
	const reactionIdempotencyKeysRef = useRef(new Map<string, { active: boolean; key: string }>());
	const { updateItem, dropVanishedAnnouncement, captureFields } = announcementListEdits(
		ctx,
		commentOverridesRef,
	);
	const comments = useAnnouncementComments(ctx, commentOverridesRef);

	async function patchAnnouncement(
		id: string,
		body: {
			pinned?: boolean;
			status?: AnnouncementStatus;
			kind?: AnnouncementKind;
			content?: string;
			expectedUpdatedAt?: string;
		},
		pendingKey: string,
		rollback: () => void,
		onSuccess?: () => void,
		onError?: (error: string) => void,
	): Promise<boolean> {
		if (isPending(pendingKey)) return false;
		start(pendingKey);
		const res = await apiFetch<AnnouncementWriteResponse>(
			`/api/wg/${encodedShareCode}/announcements/${encodeURIComponent(id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify(body),
			},
		);
		end(pendingKey);
		if (!res.ok) {
			if (res.status === 404 && res.error === 'announcement_not_found') {
				dropVanishedAnnouncement(id);
			} else {
				rollback();
				setActionError(announcementActionError(res.error));
				onError?.(res.error);
			}
			return false;
		}
		const warning = deliveryWarning(res.data.warning);
		if (warning) toast.info(render(warning));
		onSuccess?.();
		// Background merge: a tap must not shove new posts of others into the list under the reader.
		void load('background');
		return true;
	}

	function togglePinned(announcement: Announcement): void {
		const pendingKey = `${announcement.id}:pin`;
		if (isPending(pendingKey)) return;
		const rollback = captureFields(announcement.id, ['pinnedAt']);
		updateItem(announcement.id, (item) => ({
			...item,
			pinnedAt: item.pinnedAt ? null : new Date().toISOString(),
		}));
		void patchAnnouncement(
			announcement.id,
			{ pinned: !announcement.pinnedAt },
			pendingKey,
			rollback,
		);
	}

	function toggleStatus(announcement: Announcement): void {
		const pendingKey = `${announcement.id}:status`;
		if (isPending(pendingKey)) return;
		const nextStatus = announcement.status === 'resolved' ? 'open' : 'resolved';
		const rollback = captureFields(announcement.id, ['status', 'resolvedAt', 'resolvedByMemberId']);
		updateItem(announcement.id, (item) => ({
			...item,
			status: nextStatus,
			resolvedAt: nextStatus === 'resolved' ? new Date().toISOString() : null,
			resolvedByMemberId: nextStatus === 'resolved' ? identity.memberId : null,
		}));
		// Success toast only after the server responds, otherwise it contradicts the rollback on errors.
		void patchAnnouncement(
			announcement.id,
			{ status: nextStatus },
			pendingKey,
			rollback,
			nextStatus === 'resolved'
				? () => toast.success(render({ key: 'pinnwand.notices.resolved' }))
				: undefined,
		);
	}

	/** Text and type of a manual post; resolves true once saved so the editor can close. */
	function editAnnouncement(
		announcement: Announcement,
		next: { content: string; kind: AnnouncementKind },
	): Promise<boolean> {
		const body: { content?: string; kind?: AnnouncementKind } = {};
		if (next.content !== announcement.content) body.content = next.content;
		if (next.kind !== announcement.kind) body.kind = next.kind;
		return patchAnnouncement(
			announcement.id,
			announcement.updatedAt ? { ...body, expectedUpdatedAt: announcement.updatedAt } : body,
			`${announcement.id}:edit`,
			() => undefined,
			() => updateItem(announcement.id, (item) => ({ ...item, ...body })),
			(error) => {
				if (error === 'announcement_changed') void load();
			},
		);
	}

	async function toggleReaction(announcement: Announcement, reaction: ReactionKey): Promise<void> {
		const pendingKey = `${announcement.id}:reaction:${reaction}`;
		if (isPending(pendingKey)) return;
		const rollback = captureFields(announcement.id, ['myReactions', 'reactionCounts', 'takers']);
		const active = announcement.myReactions.includes(reaction);
		updateItem(announcement.id, (item) =>
			withToggledReaction(item, reaction, active, {
				memberId: identity.memberId,
				name: identity.name,
				color: members.find((member) => member.id === identity.memberId)?.color ?? null,
			}),
		);
		start(pendingKey);
		const reactionRequestKey = `${announcement.id}:${reaction}`;
		const pendingReaction = reactionIdempotencyKeysRef.current.get(reactionRequestKey);
		const idempotencyKey =
			pendingReaction?.active === !active ? pendingReaction.key : createIdempotencyKey();
		if (!idempotencyKey) {
			rollback();
			end(pendingKey);
			setActionError({ key: 'pinnwand.errors.reactionKeyUnavailable' });
			return;
		}
		reactionIdempotencyKeysRef.current.set(reactionRequestKey, {
			active: !active,
			key: idempotencyKey,
		});
		const res = await apiFetch<AnnouncementReactionResponse>(
			`/api/wg/${encodedShareCode}/announcements/${encodeURIComponent(announcement.id)}/reactions`,
			{
				method: 'POST',
				memberId: identity.memberId,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({ reaction, active: !active }),
			},
		);
		end(pendingKey);
		if (!res.ok) {
			if (shouldReleaseIdempotencyKey(res.status, res.error)) {
				reactionIdempotencyKeysRef.current.delete(reactionRequestKey);
			}
			if (res.status === 404 && res.error === 'announcement_not_found') {
				dropVanishedAnnouncement(announcement.id);
			} else if (res.status === 404 && res.error === 'reaction_not_found' && active) {
				setActionError({ key: 'pinnwand.errors.reactionAlreadyRemoved' });
			} else {
				rollback();
				setActionError(announcementActionError(res.error));
				// Someone else resolved the post meanwhile: show the real state right away.
				if (res.error === 'announcement_resolved') void load('background');
			}
			return;
		}
		reactionIdempotencyKeysRef.current.delete(reactionRequestKey);
		const warning = deliveryWarning(res.data.warning);
		if (warning) toast.info(render(warning));
		void load('background');
	}

	/** The dialog shows the error itself: null = removed (or already gone), otherwise the message. */
	async function remove(id: string): Promise<Message | null> {
		const failed: Message = { key: 'pinnwand.errors.removeFailed' };
		if (isPending(id)) return failed;
		start(id);
		const res = await apiFetch<Record<string, never>>(
			`/api/wg/${encodedShareCode}/announcements/${encodeURIComponent(id)}`,
			{
				method: 'DELETE',
				memberId: identity.memberId,
			},
		);
		end(id);
		if (!res.ok) {
			if (res.status === 404 && res.error === 'announcement_not_found') {
				dropVanishedAnnouncement(id);
				return null;
			}
			if (res.status === 403) {
				return { key: 'pinnwand.errors.removeForbidden' };
			}
			return mutationError({ key: 'pinnwand.errors.removeSubject' }, res.error, {}, failed);
		}
		commitItems(itemsRef.current.filter((item) => item.id !== id));
		void load('background');
		return null;
	}

	return {
		togglePinned,
		toggleStatus,
		editAnnouncement,
		toggleReaction,
		addComment: comments.addComment,
		updateComment: comments.updateComment,
		deleteComment: comments.deleteComment,
		remove,
	};
}
