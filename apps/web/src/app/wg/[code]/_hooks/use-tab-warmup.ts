'use client';

import { useEffect } from 'react';
import { prefetchCachedFetch } from '@/core/hooks/use-cached-fetch';

/**
 * Warms the tab data in idle time: the first switch into Household/Money/Together then
 * renders from the useCachedFetch cache instead of starting its fetch after the page JS.
 */
export function useTabWarmup(encodedShareCode: string, memberId?: string) {
	useEffect(() => {
		if (!memberId) return;
		const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
			.connection;
		if (connection?.saveData) return;
		const base = `/api/wg/${encodedShareCode}`;
		const options = { memberId };
		const warm = () => {
			for (const path of [
				'chores',
				'absences',
				'shopping',
				'expenses',
				'recurring-expenses',
				'announcements',
			]) {
				void prefetchCachedFetch(`${base}/${path}`, options);
			}
			// Evaluate the tab page chunks now: on the first switch the route only has to render
			// (the page modules are already installed), instead of download + parse + render.
			for (const load of [
				() => import('@/app/wg/[code]/chores/page'),
				() => import('@/app/wg/[code]/shopping/page'),
				() => import('@/app/wg/[code]/expenses/page'),
				() => import('@/app/wg/[code]/pinboard/page'),
				() => import('@/features/chat/components/ChatView'),
			]) {
				load().catch(() => undefined);
			}
		};
		const idle = 'requestIdleCallback' in window;
		const handle = idle
			? window.requestIdleCallback(warm, { timeout: 4000 })
			: window.setTimeout(warm, 1500);
		return () => {
			if (idle) window.cancelIdleCallback(handle);
			else window.clearTimeout(handle);
		};
	}, [encodedShareCode, memberId]);
}
