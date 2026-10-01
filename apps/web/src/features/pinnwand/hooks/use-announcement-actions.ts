import { apiFetch } from '@/core/infra/api-client';
import { notificationWarningMessage } from '@/core/notifications/notification-warning';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import {
	announcementActionErrorMessage,
	commentActionErrorMessage,
} from '@/features/pinnwand/announcement-errors';
import {
	type CommentOverride,
	type CommentOverrides,
	forgetCommentOverride as forgetOverride,
	rememberCommentOverride as rememberOverride,
} from '@/features/pinnwand/comment-overrides';
import type {
	Announcement,
	AnnouncementComment,
	AnnouncementKind,
	AnnouncementStatus,
	ReactionKey,
} from '@/features/pinnwand/components/announcement-types';
import { type MutableRefObject, useRef } from 'react';
import type {
	AnnouncementCommentResponse,
	AnnouncementPageContext,
	AnnouncementReactionResponse,
	AnnouncementWriteResponse,
} from './announcement-page-context';

/** Pinnwand-Karten: Anpinnen, Status, Reaktionen, Kommentare und Löschen, jeweils mit optimistischem Update. */
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
		setNotice,
		itemsRef,
		commitItems,
		load,
	} = ctx;
	const commentIdempotencyKeysRef = useRef(new Map<string, string>());
	const reactionIdempotencyKeysRef = useRef(new Map<string, { active: boolean; key: string }>());

	const rememberCommentOverride = (
		announcementId: string,
		commentId: string,
		comment: CommentOverride,
	): void => rememberOverride(commentOverridesRef.current, announcementId, commentId, comment);
	const forgetCommentOverride = (announcementId: string, commentId: string): void =>
		forgetOverride(commentOverridesRef.current, announcementId, commentId);

	function dropVanishedAnnouncement(id: string): void {
		commitItems(itemsRef.current.filter((item) => item.id !== id));
		setActionError('Dieser Pinnwand-Beitrag existiert nicht mehr und wurde entfernt.');
	}

	function updateItem(id: string, updater: (item: Announcement) => Announcement): void {
		commitItems(itemsRef.current.map((item) => (item.id === id ? updater(item) : item)));
	}

	async function patchAnnouncement(
		id: string,
		body: { pinned?: boolean; status?: AnnouncementStatus; kind?: AnnouncementKind },
		pendingKey: string,
		rollbackItems?: Announcement[],
	): Promise<void> {
		if (isPending(pendingKey)) return;
		start(pendingKey);
		setActionError(null);
		const res = await apiFetch<AnnouncementWriteResponse>(
			`/api/wg/${encodedShareCode}/announcements/${encodeURIComponent(id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify(body),
			},
		);
		end(pendingKey);
		if (!res.ok) {
			if (res.status === 404 && res.error === 'announcement_not_found') {
				dropVanishedAnnouncement(id);
			} else {
				if (rollbackItems) commitItems(rollbackItems);
				setActionError(announcementActionErrorMessage(res.error));
			}
			return;
		}
		const warningMessage = notificationWarningMessage(res.data.warning);
		if (warningMessage) setNotice(warningMessage);
		void load();
	}

	function togglePinned(announcement: Announcement): void {
		const pendingKey = `${announcement.id}:pin`;
		if (isPending(pendingKey)) return;
		const previousItems = itemsRef.current;
		updateItem(announcement.id, (item) => ({
			...item,
			pinnedAt: item.pinnedAt ? null : new Date().toISOString(),
		}));
		void patchAnnouncement(
			announcement.id,
			{ pinned: !announcement.pinnedAt },
			pendingKey,
			previousItems,
		);
	}

	function toggleStatus(announcement: Announcement): void {
		const pendingKey = `${announcement.id}:status`;
		if (isPending(pendingKey)) return;
		const nextStatus = announcement.status === 'resolved' ? 'open' : 'resolved';
		const previousItems = itemsRef.current;
		updateItem(announcement.id, (item) => ({
			...item,
			status: nextStatus,
			resolvedAt: nextStatus === 'resolved' ? new Date().toISOString() : null,
			resolvedByMemberId: nextStatus === 'resolved' ? identity.memberId : null,
		}));
		if (nextStatus === 'resolved') toast.success('Erledigt – liegt jetzt unter „Geklärt & älter“.');
		void patchAnnouncement(announcement.id, { status: nextStatus }, pendingKey, previousItems);
	}

	async function toggleReaction(announcement: Announcement, reaction: ReactionKey): Promise<void> {
		const pendingKey = `${announcement.id}:reaction:${reaction}`;
		if (isPending(pendingKey)) return;
		const previousItems = itemsRef.current;
		const active = announcement.myReactions.includes(reaction);
		updateItem(announcement.id, (item) => ({
			...item,
			myReactions: active
				? item.myReactions.filter((current) => current !== reaction)
				: [...item.myReactions, reaction],
			reactionCounts: {
				...item.reactionCounts,
				[reaction]: Math.max(0, (item.reactionCounts[reaction] ?? 0) + (active ? -1 : 1)),
			},
			takers:
				reaction !== 'take'
					? item.takers
					: active
						? item.takers.filter((taker) => taker.memberId !== identity.memberId)
						: [
								...item.takers,
								{
									memberId: identity.memberId,
									name: identity.name,
									color: members.find((member) => member.id === identity.memberId)?.color ?? null,
								},
							],
		}));
		start(pendingKey);
		setActionError(null);
		const reactionRequestKey = `${announcement.id}:${reaction}`;
		const pendingReaction = reactionIdempotencyKeysRef.current.get(reactionRequestKey);
		const idempotencyKey =
			pendingReaction?.active === !active ? pendingReaction.key : createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			commitItems(previousItems);
			end(pendingKey);
			setActionError('Reaktion konnte nicht sicher gesendet werden. Versuche es erneut.');
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
				memberToken: identity.memberToken,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({ reaction, active: !active }),
			},
		);
		end(pendingKey);
		if (!res.ok) {
			if (res.status > 0 && res.status < 500 && res.status !== 429) {
				reactionIdempotencyKeysRef.current.delete(reactionRequestKey);
			}
			if (res.status === 404 && res.error === 'announcement_not_found') {
				dropVanishedAnnouncement(announcement.id);
			} else if (res.status === 404 && res.error === 'reaction_not_found' && active) {
				setActionError('Diese Reaktion war schon entfernt. Die Pinnwand bleibt aktuell.');
			} else {
				commitItems(previousItems);
				setActionError(announcementActionErrorMessage(res.error));
			}
			return;
		}
		reactionIdempotencyKeysRef.current.delete(reactionRequestKey);
		const warningMessage = notificationWarningMessage(res.data.warning);
		if (warningMessage) setNotice(warningMessage);
		void load();
	}

	async function addComment(announcement: Announcement, content: string): Promise<boolean> {
		const pendingKey = `${announcement.id}:comment`;
		if (isPending(pendingKey)) return false;
		const previousItems = itemsRef.current;
		const optimisticComment: AnnouncementComment = {
			id: `temp-${Date.now()}`,
			announcementId: announcement.id,
			memberId: identity.memberId,
			content,
			createdAt: new Date().toISOString(),
			authorName: identity.name,
			authorColor: members.find((member) => member.id === identity.memberId)?.color ?? null,
		};
		rememberCommentOverride(announcement.id, optimisticComment.id, optimisticComment);
		updateItem(announcement.id, (item) => ({
			...item,
			comments: [...item.comments, optimisticComment],
		}));
		start(pendingKey);
		setActionError(null);
		const commentRequestKey = `${announcement.id}:${content}`;
		const idempotencyKey =
			commentIdempotencyKeysRef.current.get(commentRequestKey) ?? createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			end(pendingKey);
			setActionError('Kommentar konnte nicht sicher gesendet werden. Versuche es erneut.');
			return false;
		}
		commentIdempotencyKeysRef.current.set(commentRequestKey, idempotencyKey);
		const res = await apiFetch<AnnouncementCommentResponse>(
			`/api/wg/${encodedShareCode}/announcements/${encodeURIComponent(announcement.id)}/comments`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({ content }),
			},
		);
		end(pendingKey);
		if (!res.ok) {
			if (res.status > 0 && res.status < 500 && res.status !== 429) {
				commentIdempotencyKeysRef.current.delete(commentRequestKey);
			}
			if (res.status === 404 && res.error === 'announcement_not_found') {
				commentOverridesRef.current.delete(announcement.id);
				dropVanishedAnnouncement(announcement.id);
			} else {
				forgetCommentOverride(announcement.id, optimisticComment.id);
				commitItems(previousItems);
				setActionError(commentActionErrorMessage(res.error));
			}
			return false;
		}
		commentIdempotencyKeysRef.current.delete(commentRequestKey);
		forgetCommentOverride(announcement.id, optimisticComment.id);
		const confirmedComment = { ...optimisticComment, ...res.data.comment };
		rememberCommentOverride(announcement.id, confirmedComment.id, confirmedComment);
		updateItem(announcement.id, (item) => ({
			...item,
			comments: item.comments.map((comment) =>
				comment.id === optimisticComment.id ? confirmedComment : comment,
			),
		}));
		const warningMessage = notificationWarningMessage(res.data.warning);
		if (warningMessage) setNotice(warningMessage);
		void load('background');
		return true;
	}

	async function updateComment(
		announcement: Announcement,
		commentId: string,
		content: string,
	): Promise<boolean> {
		const pendingKey = `${commentId}:comment-edit`;
		if (isPending(pendingKey)) return false;
		const previousItems = itemsRef.current;
		const previousComment = announcement.comments.find((comment) => comment.id === commentId);
		if (previousComment) {
			rememberCommentOverride(announcement.id, commentId, { ...previousComment, content });
		}
		updateItem(announcement.id, (item) => ({
			...item,
			comments: item.comments.map((comment) =>
				comment.id === commentId ? { ...comment, content } : comment,
			),
		}));
		start(pendingKey);
		setActionError(null);
		const res = await apiFetch<{ comment: AnnouncementComment }>(
			`/api/wg/${encodedShareCode}/announcements/${encodeURIComponent(announcement.id)}/comments/${encodeURIComponent(commentId)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({ content }),
			},
		);
		end(pendingKey);
		if (!res.ok) {
			if (res.status === 404 && res.error === 'comment_not_found') {
				forgetCommentOverride(announcement.id, commentId);
				updateItem(announcement.id, (item) => ({
					...item,
					comments: item.comments.filter((comment) => comment.id !== commentId),
				}));
				setActionError('Dieser Kommentar existiert nicht mehr und wurde entfernt.');
				return true;
			}
			forgetCommentOverride(announcement.id, commentId);
			commitItems(previousItems);
			setActionError(commentActionErrorMessage(res.error));
			return false;
		}
		const confirmedComment = { ...previousComment, ...res.data.comment };
		rememberCommentOverride(announcement.id, confirmedComment.id, confirmedComment);
		updateItem(announcement.id, (item) => ({
			...item,
			comments: item.comments.map((comment) =>
				comment.id === commentId ? confirmedComment : comment,
			),
		}));
		void load('background');
		return true;
	}

	async function deleteComment(announcement: Announcement, commentId: string): Promise<boolean> {
		const pendingKey = `${commentId}:comment-delete`;
		if (isPending(pendingKey)) return false;
		const previousItems = itemsRef.current;
		rememberCommentOverride(announcement.id, commentId, null);
		updateItem(announcement.id, (item) => ({
			...item,
			comments: item.comments.filter((comment) => comment.id !== commentId),
		}));
		start(pendingKey);
		setActionError(null);
		const res = await apiFetch<Record<string, never>>(
			`/api/wg/${encodedShareCode}/announcements/${encodeURIComponent(announcement.id)}/comments/${encodeURIComponent(commentId)}`,
			{
				method: 'DELETE',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
			},
		);
		end(pendingKey);
		if (!res.ok) {
			if (res.status === 404 && res.error === 'comment_not_found') {
				setActionError('Dieser Kommentar existiert nicht mehr und wurde entfernt.');
			} else {
				forgetCommentOverride(announcement.id, commentId);
				commitItems(previousItems);
				setActionError(commentActionErrorMessage(res.error));
			}
			return false;
		}
		void load('background');
		return true;
	}

	async function remove(id: string): Promise<boolean> {
		if (isPending(id)) return false;
		start(id);
		setActionError(null);
		const res = await apiFetch<Record<string, never>>(
			`/api/wg/${encodedShareCode}/announcements/${encodeURIComponent(id)}`,
			{
				method: 'DELETE',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
			},
		);
		end(id);
		if (!res.ok) {
			if (res.status === 404 && res.error === 'announcement_not_found') {
				dropVanishedAnnouncement(id);
			} else {
				const msg =
					res.status === 403
						? 'Nur wer den Beitrag geschrieben hat oder WG-Admins können ihn entfernen.'
						: announcementActionErrorMessage(res.error);
				setActionError(msg);
			}
			return false;
		}
		commitItems(itemsRef.current.filter((item) => item.id !== id));
		void load();
		return true;
	}

	return {
		togglePinned,
		toggleStatus,
		toggleReaction,
		addComment,
		updateComment,
		deleteComment,
		remove,
	};
}
