'use client';

import type { ActivityItem, ActivityReminder } from '@/composition/activity';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useSyncedCollection } from '@/core/sync/use-synced-collection';
import { useEffect, useRef, useState } from 'react';

interface ActivityResponse {
	items: ActivityItem[];
	reminders: ActivityReminder[];
}

/**
 * The newest `limit` activity entries of a WG, kept fresh by polling. Raising `limit` fetches a
 * larger page under a new cache key; the rows and reminders already shown stay on screen until
 * the larger page lands.
 */
export function useActivityFeed({
	shareCode,
	memberId,
	limit,
}: { shareCode: string; memberId: string; limit: number }) {
	const url = `/api/wg/${encodeURIComponent(shareCode)}/activity?limit=${limit}`;
	const { data, items, initialLoading, refreshing, loadError, load } = useSyncedCollection<
		ActivityResponse,
		ActivityItem
	>({
		url,
		memberId,
		select: (response) => response.items,
		assemble: (nextItems, current) => ({ reminders: current?.reminders ?? [], items: nextItems }),
		getId: (item) => item.id,
		describeError: (error) => getWgLoadErrorMessage('Aktivität', error.status, error.error),
	});

	// The reminders belong to the response, which is empty under a fresh cache key; hold the last ones.
	const [reminders, setReminders] = useState<ActivityReminder[] | null>(data?.reminders ?? null);
	if (data && data.reminders !== reminders) setReminders(data.reminders);

	// A new limit is a new URL: the cached fetch starts it, this marks the page as refreshing.
	const loadedUrlRef = useRef(url);
	useEffect(() => {
		if (loadedUrlRef.current === url) return;
		loadedUrlRef.current = url;
		void load({ silent: true });
	}, [url, load]);

	return {
		items,
		reminders,
		loaded: reminders !== null,
		loading: initialLoading || refreshing,
		error: loadError,
		reload: () => void load({ silent: true }),
	};
}
