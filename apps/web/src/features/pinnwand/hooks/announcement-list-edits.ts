import type { MutableRefObject } from 'react';
import { withReplacedComment, withRestoredFields } from '@/features/pinnwand/announcement-edits';
import {
	type CommentOverride,
	type CommentOverrides,
	forgetCommentOverride,
	rememberCommentOverride,
} from '@/features/pinnwand/comment-overrides';
import type {
	Announcement,
	AnnouncementComment,
} from '@/features/pinnwand/components/announcement-types';
import type { AnnouncementPageContext } from './announcement-page-context';

/** Card-level writes to the board shared by the Pinnwand action hooks. */
export function announcementListEdits(
	ctx: Pick<AnnouncementPageContext, 'itemsRef' | 'commitItems' | 'setActionError'>,
	commentOverridesRef: MutableRefObject<CommentOverrides>,
) {
	const { itemsRef, commitItems, setActionError } = ctx;

	function updateItem(id: string, updater: (item: Announcement) => Announcement): void {
		commitItems(itemsRef.current.map((item) => (item.id === id ? updater(item) : item)));
	}

	return {
		updateItem,
		dropVanishedAnnouncement(id: string): void {
			commitItems(itemsRef.current.filter((item) => item.id !== id));
			setActionError({ key: 'pinnwand.errors.vanished' });
		},
		/**
		 * Captures the given fields of one card now and returns a function that puts only those
		 * back. Restoring a snapshot of the whole list instead would also undo changes to other
		 * cards that succeeded while this request was in flight.
		 */
		captureFields<K extends keyof Announcement>(id: string, keys: readonly K[]): () => void {
			const before = itemsRef.current.find((item) => item.id === id);
			return () => {
				if (before) updateItem(id, (item) => withRestoredFields(item, before, keys));
			};
		},
		replaceComment(
			announcementId: string,
			commentId: string,
			replacement: AnnouncementComment | null,
		): void {
			updateItem(announcementId, (item) => withReplacedComment(item, commentId, replacement));
		},
		rememberCommentOverride(
			announcementId: string,
			commentId: string,
			comment: CommentOverride,
		): void {
			rememberCommentOverride(commentOverridesRef.current, announcementId, commentId, comment);
		},
		forgetCommentOverride(announcementId: string, commentId: string): void {
			forgetCommentOverride(commentOverridesRef.current, announcementId, commentId);
		},
	};
}
