import type { AnnouncementKind } from '@/features/announcements/announcement-workflow';
import type {
	Announcement,
	AnnouncementComment,
	ReactionKey,
} from '@/features/announcements/components/announcement-types';

/** Optimistic card edits; pure so the board can apply and roll them back field by field. */

interface Reactor {
	memberId: string;
	name: string;
	color: string | null;
}

/** The card after the viewer toggled `reaction`; "take" also adds or removes them as taker. */
export function withToggledReaction(
	item: Announcement,
	reaction: ReactionKey,
	active: boolean,
	reactor: Reactor,
): Announcement {
	return {
		...item,
		myReactions: active
			? item.myReactions.filter((current) => current !== reaction)
			: [...item.myReactions, reaction],
		...(reaction === 'seen' || reaction === 'ok'
			? { myAcknowledgedAt: active ? null : new Date().toISOString() }
			: {}),
		reactionCounts: {
			...item.reactionCounts,
			[reaction]: Math.max(0, (item.reactionCounts[reaction] ?? 0) + (active ? -1 : 1)),
		},
		takers:
			reaction !== 'take'
				? item.takers
				: active
					? item.takers.filter((taker) => taker.memberId !== reactor.memberId)
					: [...item.takers, reactor],
	};
}

/** The card with one comment replaced (or removed), comments kept in creation order. */
export function withReplacedComment(
	item: Announcement,
	commentId: string,
	replacement: AnnouncementComment | null,
): Announcement {
	const others = item.comments.filter((comment) => comment.id !== commentId);
	const comments = replacement ? [...others, replacement] : others;
	return {
		...item,
		comments: comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
	};
}

/** `item` with the given fields taken from `before`; other fields keep their newer values. */
export function withRestoredFields<K extends keyof Announcement>(
	item: Announcement,
	before: Announcement,
	keys: readonly K[],
): Announcement {
	const restored = { ...item };
	for (const key of keys) restored[key] = before[key];
	return restored;
}

/** A saved draft is only worth restoring when it holds text that differs from the starting text. */
export function isRestorableDraft(saved: unknown, initial: string): saved is { content: string } {
	const content = (saved as { content?: unknown } | null | undefined)?.content;
	return typeof content === 'string' && content.length > 0 && content !== initial;
}

/** How a post edit save ended; a conflict means another change landed first and the list reloads. */
export type AnnouncementEditResult = 'saved' | 'conflict' | 'failed';

/** After a version conflict: untouched fields follow `latest`, touched fields keep what was typed. */
export function rebaseAnnouncementEdit(
	base: Announcement,
	latest: Announcement,
	form: { content: string; kind: AnnouncementKind },
): { content: string; kind: AnnouncementKind } {
	return {
		content: form.content.trim() === base.content.trim() ? latest.content : form.content,
		kind: form.kind === base.kind ? latest.kind : form.kind,
	};
}
