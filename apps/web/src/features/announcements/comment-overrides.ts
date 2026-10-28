import type {
	Announcement,
	AnnouncementComment,
} from '@/features/announcements/components/announcement-types';

/**
 * Optimistic comment changes that must survive background reloads until the server
 * reflects them. `null` means deleted.
 */
export type CommentOverride = AnnouncementComment | null;
export type CommentOverrides = Map<string, Map<string, CommentOverride>>;

export function rememberCommentOverride(
	store: CommentOverrides,
	announcementId: string,
	commentId: string,
	comment: CommentOverride,
): void {
	const overrides = store.get(announcementId) ?? new Map<string, CommentOverride>();
	overrides.set(commentId, comment);
	store.set(announcementId, overrides);
}

export function forgetCommentOverride(
	store: CommentOverrides,
	announcementId: string,
	commentId: string,
): void {
	const overrides = store.get(announcementId);
	if (!overrides) return;
	overrides.delete(commentId);
	if (overrides.size === 0) store.delete(announcementId);
}

export function applyCommentOverrides(store: CommentOverrides, item: Announcement): Announcement {
	const overrides = store.get(item.id);
	if (!overrides || overrides.size === 0) return item;
	const remoteComments = new Map(item.comments.map((comment) => [comment.id, comment]));
	const comments = item.comments.flatMap((comment) => {
		if (!overrides.has(comment.id)) return [comment];
		const override = overrides.get(comment.id);
		if (override === null) return [];
		if (override && override.content === comment.content) {
			overrides.delete(comment.id);
			return [comment];
		}
		return override ? [override] : [comment];
	});
	for (const [commentId, override] of overrides) {
		if (override === null) {
			if (!remoteComments.has(commentId)) overrides.delete(commentId);
			continue;
		}
		if (!remoteComments.has(commentId)) comments.push(override);
	}
	if (overrides.size === 0) store.delete(item.id);
	const unchanged =
		comments.length === item.comments.length &&
		comments.every((comment, index) => comment === item.comments[index]);
	return unchanged ? item : { ...item, comments };
}
