'use client';

import type { DashboardData } from '@/composition/dashboard-data';
import { getBerlinWeekWindow } from '@/composition/dashboard-insights';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/use-cached-fetch';
import { subscribeVisibility, useOnlineStatus } from '@/core/hooks/use-online-status';
import { OFFLINE_SYNCED_EVENT, getSyncedCountForWg } from '@/core/offline/offline-client';
import { berlinDayKey } from '@/core/utils/berlin-day';
import {
	LIST_REFRESH_INTERVAL_MS,
	useVisibilityPausedInterval,
} from '@/core/utils/use-visibility-paused-interval';
import { type SerializedWgEvent, expandRecurrence } from '@/features/events/events';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface HomeDataIdentity {
	memberId: string;
}

/**
 * Reads for the start page: the dashboard and this Berlin week's events. Both refresh every
 * 30 s while visible, on focus, after an offline sync, and the week moves at Berlin midnight.
 */
export function useHomeData(shareCode: string, identity: HomeDataIdentity) {
	const online = useOnlineStatus();
	const [berlinTodayKey, setBerlinTodayKey] = useState(() => berlinDayKey(new Date()));
	const [agendaNow, setAgendaNow] = useState(() => Date.now());
	const encodedShareCode = encodeURIComponent(shareCode);
	const weekWindow = useMemo(
		() => getBerlinWeekWindow(Date.parse(`${berlinTodayKey}T12:00:00.000Z`)),
		[berlinTodayKey],
	);
	const auth = { memberId: identity.memberId };
	const dashboardRead = useCachedFetch<DashboardData>(
		`/api/wg/${encodedShareCode}/dashboard`,
		auth,
	);
	const eventUrl = `/api/wg/${encodedShareCode}/events?from=${encodeURIComponent(weekWindow.from.toISOString())}&to=${encodeURIComponent(weekWindow.to.toISOString())}`;
	const eventRead = useCachedFetch<{ events: SerializedWgEvent[] }>(eventUrl, auth);
	const error = dashboardRead.error
		? getWgLoadErrorMessage('Die Startseite', dashboardRead.error.status, dashboardRead.error.error)
		: null;
	const eventOccurrences = useMemo(
		() =>
			(eventRead.data?.events ?? []).flatMap((event) =>
				expandRecurrence(event, weekWindow.from, weekWindow.to),
			),
		[eventRead.data, weekWindow],
	);

	const load = useCallback(() => {
		const now = Date.now();
		setAgendaNow(now);
		const nextTodayKey = berlinDayKey(new Date(now));
		if (nextTodayKey !== berlinTodayKey) setBerlinTodayKey(nextTodayKey);
		else void eventRead.refresh();
		void dashboardRead.refresh();
	}, [berlinTodayKey, dashboardRead.refresh, eventRead.refresh]);

	useVisibilityPausedInterval(() => void load(), LIST_REFRESH_INTERVAL_MS);
	useEffect(() => {
		const onShow = () => {
			if (document.visibilityState === 'visible') load();
		};
		const unsubscribeVisibility = subscribeVisibility((visible) => {
			if (visible) load();
		});
		// A queued chore completion reaches the server through the shell's background sync.
		const onSynced = (event: Event) => {
			if (getSyncedCountForWg(event, shareCode) > 0) load();
		};
		window.addEventListener('focus', onShow);
		window.addEventListener(OFFLINE_SYNCED_EVENT, onSynced);
		return () => {
			unsubscribeVisibility();
			window.removeEventListener('focus', onShow);
			window.removeEventListener(OFFLINE_SYNCED_EVENT, onSynced);
		};
	}, [load, shareCode]);

	return {
		online,
		data: dashboardRead.data ?? null,
		loading: dashboardRead.isLoading,
		error,
		eventRead,
		eventOccurrences,
		berlinTodayKey,
		agendaNow,
		load,
	};
}
