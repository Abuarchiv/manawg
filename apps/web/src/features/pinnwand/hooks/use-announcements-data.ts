import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { captureException } from '@/core/infra/capture-client';
import { syncOfflineActions } from '@/core/offline/offline-client';
import { useOfflineQueueSync } from '@/core/offline/useOfflineQueueSync';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import {
	mergeBackgroundAnnouncements,
	reconcilePendingAnnouncements,
} from '@/features/pinnwand/announcement-workflow';
import {
	type CommentOverrides,
	applyCommentOverrides as applyOverrides,
} from '@/features/pinnwand/comment-overrides';
import type { Announcement } from '@/features/pinnwand/components/announcement-types';
import { REFRESH_INTERVAL_MS } from '@/features/pinnwand/components/constants';
import { useCallback, useEffect, useRef, useState } from 'react';

interface AnnouncementsDataParams {
	wg: { shareCode: string };
	identity: { memberId: string };
	encodedShareCode: string;
}

/** Pinnwand-Beiträge: Cache-Start, Laden, Hintergrund-Refresh, „neue Beiträge“-Hinweis und Offline-Sync. */
export function useAnnouncementsData({ wg, identity, encodedShareCode }: AnnouncementsDataParams) {
	const {
		data: cachedAnnouncements,
		serverData: remoteAnnouncements,
		serverRevision: announcementsServerRevision,
		error: announcementsReadError,
		refresh: refreshAnnouncements,
		setData: setCachedAnnouncements,
	} = useCachedFetch<{ announcements: Announcement[] }>(
		`/api/wg/${encodedShareCode}/announcements`,
		{ memberId: identity.memberId },
	);
	const processedAnnouncementsRevisionRef = useRef(announcementsServerRevision);
	const [items, setItems] = useState<Announcement[]>(
		() => cachedAnnouncements?.announcements ?? [],
	);
	const [initialLoading, setInitialLoading] = useState(cachedAnnouncements === undefined);
	const isFirstLoad = useRef(cachedAnnouncements === undefined);
	const itemsRef = useRef<Announcement[]>(cachedAnnouncements?.announcements ?? []);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [pendingRemoteItems, setPendingRemoteItems] = useState<Announcement[] | null>(null);
	const [newCount, setNewCount] = useState(0);
	const commentOverridesRef = useRef<CommentOverrides>(new Map());
	const mountedRef = useRef(false);
	const loadRequestIdRef = useRef(0);
	const initialLoadStartedRef = useRef(false);

	useEffect(() => {
		itemsRef.current = items;
	}, [items]);

	useEffect(() => {
		if (announcementsReadError) {
			setLoadError(
				getWgLoadErrorMessage(
					'Pinnwand',
					announcementsReadError.status,
					announcementsReadError.error,
				),
			);
			setInitialLoading(false);
			isFirstLoad.current = false;
			return;
		}
		if (cachedAnnouncements) {
			const current = itemsRef.current;
			const incoming = cachedAnnouncements.announcements.map(applyCommentOverrides);
			const merged =
				current.length > 0 ? mergeBackgroundAnnouncements(current, incoming) : incoming;
			itemsRef.current = merged;
			setItems(merged);
			const pending = remoteAnnouncements
				? reconcilePendingAnnouncements(
						current,
						remoteAnnouncements.announcements,
						announcementsServerRevision,
						processedAnnouncementsRevisionRef.current,
					)
				: null;
			if (pending) {
				processedAnnouncementsRevisionRef.current = pending.serverRevision;
				setLoadError(null);
				if (current.length > 0) {
					setPendingRemoteItems(pending.items);
					setNewCount(pending.count);
				} else {
					setPendingRemoteItems(null);
					setNewCount(0);
				}
			}
			setInitialLoading(false);
			isFirstLoad.current = false;
		}
	}, [
		announcementsReadError,
		announcementsServerRevision,
		cachedAnnouncements,
		remoteAnnouncements,
	]);

	const load = useCallback(
		async (mode: 'replace' | 'background' = 'replace'): Promise<void> => {
			const requestId = loadRequestIdRef.current + 1;
			loadRequestIdRef.current = requestId;
			if (!isFirstLoad.current) setRefreshing(true);
			const res = await refreshAnnouncements();
			if (requestId !== loadRequestIdRef.current) {
				if (isFirstLoad.current) {
					isFirstLoad.current = false;
					setInitialLoading(false);
				}
				setRefreshing(false);
				return;
			}

			if (res.ok) {
				setLoadError(null);
				syncOfflineActions(wg.shareCode, { memberId: identity.memberId })
					.then((synced) => {
						if (!mountedRef.current) return;
						if (requestId !== loadRequestIdRef.current) return;
						refreshCount();
						if (synced > 0) void load('replace');
					})
					.catch((err) =>
						captureException(err, { action: 'syncOfflineActions', page: 'pinnwand' }),
					);
				const currentItems = itemsRef.current;
				if (mode === 'background' && currentItems.length > 0) {
					commitItems(
						mergeBackgroundAnnouncements(currentItems, res.data.announcements).map(
							applyCommentOverrides,
						),
					);
					const pending = reconcilePendingAnnouncements(
						currentItems,
						res.serverData?.announcements ?? res.data.announcements,
						res.serverRevision,
						processedAnnouncementsRevisionRef.current,
					);
					if (pending) {
						processedAnnouncementsRevisionRef.current = pending.serverRevision;
						setPendingRemoteItems(pending.items);
						setNewCount(pending.count);
					}
				} else {
					processedAnnouncementsRevisionRef.current = Math.max(
						processedAnnouncementsRevisionRef.current,
						res.serverRevision,
					);
					commitItems(res.data.announcements.map(applyCommentOverrides));
					setPendingRemoteItems(null);
					setNewCount(0);
				}
			} else {
				setLoadError(getWgLoadErrorMessage('Pinnwand', res.status, res.error));
			}
			if (isFirstLoad.current) {
				isFirstLoad.current = false;
				setInitialLoading(false);
			}
			setRefreshing(false);
		},
		[identity.memberId, refreshAnnouncements, wg.shareCode],
	);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (initialLoadStartedRef.current) return;
		initialLoadStartedRef.current = true;
		void load();
	}, [load]);

	const { queuedCount, refreshCount } = useOfflineQueueSync({
		shareCode: wg.shareCode,
		memberId: identity.memberId,
		page: 'pinnwand',
		onSynced: () => void load('replace'),
	});

	useVisibilityPausedInterval(() => void load('background'), REFRESH_INTERVAL_MS);

	function applyPendingItems(): void {
		if (!pendingRemoteItems) return;
		commitItems(pendingRemoteItems.map(applyCommentOverrides));
		setPendingRemoteItems(null);
		setNewCount(0);
	}

	function commitItems(nextItems: Announcement[]): void {
		itemsRef.current = nextItems;
		setItems(nextItems);
		setCachedAnnouncements({ announcements: nextItems });
	}

	const applyCommentOverrides = (item: Announcement): Announcement =>
		applyOverrides(commentOverridesRef.current, item);

	return {
		items,
		itemsRef,
		commitItems,
		applyCommentOverrides,
		commentOverridesRef,
		initialLoading,
		refreshing,
		loadError,
		load,
		newCount,
		applyPendingItems,
		queuedCount,
		refreshCount,
	};
}
