import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useWg } from '@/components/wg/WgContextProvider';
import { usePendingSet } from '@/core/hooks/use-pending-set';
import { useStableCallback } from '@/core/hooks/use-stable-callback';
import {
	getMyOpenAnnouncements,
	isAnnouncementArchived,
} from '@/features/announcements/announcement-workflow';
import type {
	Announcement,
	ReactionKey,
} from '@/features/announcements/components/announcement-types';
import { type Message, useMessage } from '@/shared/i18n/message';
import type { AnnouncementPageContext } from './announcement-page-context';
import { useAnnouncementActions } from './use-announcement-actions';
import { useAnnouncementComposer } from './use-announcement-composer';
import { useAnnouncementsData } from './use-announcements-data';

const CARD_RENDER_PAGE = 30;

const ARCHIVED_LINK_NOTICE: Message = { key: 'pinboard.notices.archivedLink' };

/** Pinboard page: connects loading, composing and card actions and derives the display. */
export function useAnnouncementsPage() {
	const { wg, members, identity, isAdmin } = useWg();
	const toast = useToast();
	const render = useMessage();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const [notice, setNotice] = useState<Message | null>(null);
	const [highlightedId, setHighlightedId] = useState<string | null>(null);
	const { isPending, start, end } = usePendingSet();

	const data = useAnnouncementsData({
		wg,
		identity,
		encodedShareCode,
		onQueueSynced: () => setNotice(null),
	});
	const { items, itemsRef, initialLoading } = data;
	const itemCount = items.length;

	const ctx: AnnouncementPageContext = {
		wg,
		identity,
		members,
		toast,
		encodedShareCode,
		isPending,
		start,
		end,
		// Errors as toast: a page alert above the list lies outside the field of view where one is typing.
		setActionError: (message) => {
			if (message) toast.error(render(message));
		},
		setNotice,
		itemsRef,
		commitItems: data.commitItems,
		load: data.load,
		refreshCount: data.refreshCount,
	};

	const scrollToAnnouncement = useCallback((id: string, behavior: ScrollBehavior = 'auto') => {
		setHighlightedId(id);
		window.setTimeout(() => {
			document.getElementById(`announcement-${id}`)?.scrollIntoView({
				block: 'center',
				behavior,
			});
		}, 80);
		window.setTimeout(() => setHighlightedId((current) => (current === id ? null : current)), 4500);
	}, []);

	useEffect(() => {
		function applyHash(): boolean {
			const hash = window.location.hash;
			if (!hash.startsWith('#announcement-')) return false;
			const id = decodeURIComponent(hash.slice('#announcement-'.length));
			if (id) scrollToAnnouncement(id, 'auto');
			return Boolean(id);
		}
		// ?highlight=<id> as in the other areas; #announcement-<id> takes precedence.
		if (!applyHash()) {
			const id = new URLSearchParams(window.location.search).get('highlight');
			if (id) scrollToAnnouncement(id, 'auto');
		}
		window.addEventListener('hashchange', applyHash);
		return () => window.removeEventListener('hashchange', applyHash);
	}, [scrollToAnnouncement]);

	useEffect(() => {
		if (!highlightedId || itemCount === 0) return;
		// Done posts leave the board; a link to one says so instead of scrolling nowhere.
		const target = itemsRef.current.find((item) => item.id === highlightedId);
		if (target && isAnnouncementArchived(target, Date.now())) {
			setNotice(ARCHIVED_LINK_NOTICE);
			return;
		}
		const timer = window.setTimeout(
			() =>
				document.getElementById(`announcement-${highlightedId}`)?.scrollIntoView({
					block: 'center',
				}),
			80,
		);
		return () => window.clearTimeout(timer);
	}, [highlightedId, itemCount, itemsRef]);

	const composer = useAnnouncementComposer(ctx, scrollToAnnouncement);
	const actions = useAnnouncementActions(ctx, data.commentOverridesRef);

	const showSkeleton = initialLoading && items.length === 0;
	// Resolved posts and acknowledged infos are not shown at all: the board holds only what is open.
	const openItems = useMemo(() => {
		const now = Date.now();
		return items.filter((item) => !isAnnouncementArchived(item, now));
	}, [items]);
	const [openLimit, setOpenLimit] = useState(CARD_RENDER_PAGE);
	// The linked/highlighted element must always be in the DOM.
	const visibleOpenCount = Math.max(
		openLimit,
		openItems.findIndex((item) => item.id === highlightedId) + 1,
	);
	const myOpenItems = useMemo(() => getMyOpenAnnouncements(items), [items]);

	const authorByMemberId = useMemo(
		() => new Map(members.map((m) => [m.id, { name: m.name, color: m.color ?? null }] as const)),
		[members],
	);
	const stableDelete = useStableCallback((a: Announcement) => actions.remove(a.id));
	const stableTogglePinned = useStableCallback(actions.togglePinned);
	const stableToggleStatus = useStableCallback(actions.toggleStatus);
	const stableEdit = useStableCallback(actions.editAnnouncement);
	const stableToggleReaction = useStableCallback((a: Announcement, reaction: ReactionKey) => {
		const now = Date.now();
		const acknowledged = {
			...a,
			myReactions: [...a.myReactions, reaction],
			myAcknowledgedAt: new Date(now).toISOString(),
		};
		if (
			!a.myReactions.includes(reaction) &&
			!isAnnouncementArchived(a, now) &&
			isAnnouncementArchived(acknowledged, now)
		) {
			toast.info(render({ key: 'pinboard.notices.archived' }));
		}
		void actions.toggleReaction(a, reaction);
	});
	const stableAddComment = useStableCallback(actions.addComment);
	const stableUpdateComment = useStableCallback(actions.updateComment);
	const stableDeleteComment = useStableCallback(actions.deleteComment);

	return {
		wg,
		identity,
		isAdmin,
		items,
		openItems,
		myOpenItems,
		visibleOpenCount,
		showMoreOpen: () => setOpenLimit(visibleOpenCount + CARD_RENDER_PAGE),
		initialLoading,
		showSkeleton,
		loadError: data.loadError,
		refreshing: data.refreshing,
		load: data.load,
		newCount: data.newCount,
		applyPendingItems: data.applyPendingItems,
		queuedCount: data.queuedCount,
		notice,
		setNotice,
		highlightedId,
		scrollToAnnouncement,
		authorByMemberId,
		isPending,
		stableDelete,
		stableTogglePinned,
		stableToggleStatus,
		stableEdit,
		stableToggleReaction,
		stableAddComment,
		stableUpdateComment,
		stableDeleteComment,
		composer,
	};
}
