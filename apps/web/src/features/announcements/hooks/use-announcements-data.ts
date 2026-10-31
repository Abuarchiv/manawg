import { useCallback, useEffect, useRef, useState } from 'react';
import { wgLoadError } from '@/core/guards/load-errors';
import { useSyncedCollection } from '@/core/sync/use-synced-collection';
import {
	mergeBackgroundAnnouncements,
	reconcilePendingAnnouncements,
} from '@/features/announcements/announcement-workflow';
import {
	applyCommentOverrides as applyOverrides,
	type CommentOverrides,
} from '@/features/announcements/comment-overrides';
import type { Announcement } from '@/features/announcements/components/announcement-types';
import { useMessage } from '@/shared/i18n/message';

interface AnnouncementsDataParams {
	wg: { shareCode: string };
	identity: { memberId: string };
	encodedShareCode: string;
	/** Queued offline posts were sent: "saved offline" notices are obsolete. */
	onQueueSynced: () => void;
}

interface AnnouncementsResponse {
	announcements: Announcement[];
}

type LoadMode = 'replace' | 'background';

/**
 * Noticeboard posts, synced. Background refreshes update visible posts in place; new posts wait
 * behind the "N new posts" banner so the board never jumps under the reader.
 */
export function useAnnouncementsData({
	wg,
	identity,
	encodedShareCode,
	onQueueSynced,
}: AnnouncementsDataParams) {
	const render = useMessage();
	const commentOverridesRef = useRef<CommentOverrides>(new Map());
	const applyCommentOverrides = (item: Announcement): Announcement =>
		applyOverrides(commentOverridesRef.current, item);
	// The rows on screen right before the latest cache state was merged in; the banner counts
	// the server's posts that were not among them.
	const shownBeforeMergeRef = useRef<Announcement[]>([]);
	const [pendingRemoteItems, setPendingRemoteItems] = useState<Announcement[] | null>(null);
	const [newCount, setNewCount] = useState(0);

	const board = useSyncedCollection<AnnouncementsResponse, Announcement>({
		url: `/api/wg/${encodedShareCode}/announcements`,
		memberId: identity.memberId,
		select: (data) => data.announcements,
		assemble: (announcements, current) => ({ ...current, announcements }),
		getId: (item) => item.id,
		reconcile: (shown, incoming) => {
			shownBeforeMergeRef.current = shown;
			const withOverrides = incoming.map(applyCommentOverrides);
			return shown.length > 0 ? mergeBackgroundAnnouncements(shown, withOverrides) : withOverrides;
		},
		describeError: (error) =>
			render(wgLoadError({ key: 'pinboard.load.board' }, error.status, error.error)),
		reload: (reason) => void load(reason === 'poll' ? 'background' : 'replace'),
		offline: { shareCode: wg.shareCode, page: 'pinboard', onReplayed: onQueueSynced },
	});
	const { itemsRef, serverData, serverRevision } = board;
	const processedRevisionRef = useRef(serverRevision);
	const commitBoard = board.commit;
	const loadBoard = board.load;

	const commitItems = useCallback(
		(nextItems: Announcement[]) => commitBoard(() => nextItems),
		[commitBoard],
	);

	// A server response that reached the cache (from any fetch) may bring new posts.
	useEffect(() => {
		if (!serverData) return;
		const shown = shownBeforeMergeRef.current;
		const pending = reconcilePendingAnnouncements(
			shown,
			serverData.announcements,
			serverRevision,
			processedRevisionRef.current,
		);
		if (!pending) return;
		processedRevisionRef.current = pending.serverRevision;
		if (shown.length > 0) {
			setPendingRemoteItems(pending.items);
			setNewCount(pending.count);
		} else {
			setPendingRemoteItems(null);
			setNewCount(0);
		}
	}, [serverData, serverRevision]);

	const load = useCallback(
		async (mode: LoadMode = 'replace'): Promise<void> => {
			const res = await loadBoard({ silent: mode === 'background' });
			if (!res?.ok) return;
			const currentItems = itemsRef.current;
			if (mode === 'background' && currentItems.length > 0) {
				commitItems(
					mergeBackgroundAnnouncements(currentItems, res.data.announcements).map((item) =>
						applyOverrides(commentOverridesRef.current, item),
					),
				);
				const pending = reconcilePendingAnnouncements(
					currentItems,
					res.serverData?.announcements ?? res.data.announcements,
					res.serverRevision,
					processedRevisionRef.current,
				);
				if (pending) {
					processedRevisionRef.current = pending.serverRevision;
					setPendingRemoteItems(pending.items);
					setNewCount(pending.count);
				}
				return;
			}
			processedRevisionRef.current = Math.max(processedRevisionRef.current, res.serverRevision);
			commitItems(
				res.data.announcements.map((item) => applyOverrides(commentOverridesRef.current, item)),
			);
			setPendingRemoteItems(null);
			setNewCount(0);
		},
		[commitItems, itemsRef, loadBoard],
	);

	function applyPendingItems(): void {
		if (!pendingRemoteItems) return;
		const shown = new Map(itemsRef.current.map((item) => [item.id, item]));
		commitItems(
			pendingRemoteItems.map((item) => applyCommentOverrides(shown.get(item.id) ?? item)),
		);
		setPendingRemoteItems(null);
		setNewCount(0);
	}

	return {
		items: board.items,
		itemsRef,
		commitItems,
		applyCommentOverrides,
		commentOverridesRef,
		initialLoading: board.initialLoading,
		refreshing: board.refreshing,
		loadError: board.loadError,
		load,
		newCount,
		applyPendingItems,
		queuedCount: board.queuedCount,
		refreshCount: board.refreshCount,
	};
}
