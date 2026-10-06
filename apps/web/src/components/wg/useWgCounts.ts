'use client';

import { useWg } from '@/components/wg/WgContextProvider';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { useCallback, useEffect } from 'react';
import { type DueChoreRef, countOwnDueChores } from './own-due-chores';

/** The part of the dashboard read (`GET /api/wg/<code>/dashboard`) the segment counts use. */
interface DashboardCountsRead {
	openShoppingCount: number;
	dueChores: DueChoreRef[];
	dueRecurringExpenses: unknown[];
}

export type SegmentCountState = 'ready' | 'loading' | 'unavailable' | 'stale';

export interface SegmentCount {
	count: number | undefined;
	hint: string;
	state: SegmentCountState;
	overflow?: boolean | undefined;
}

export interface ChatUnreadCount {
	count: number;
	overflow: boolean;
	/** Missing only for cached responses created before exact totals were added. */
	exactCount?: number | undefined;
}

export interface ChatUnreadSnapshot {
	data: ChatUnreadCount | undefined;
	error: boolean;
	refresh: () => void;
}

const CHAT_READ_CONFIRMED_EVENT = 'manawg:chat-read-confirmed';

/** Refresh the shared unread count only after the read endpoint confirms it. */
export function notifyChatReadConfirmed(shareCode: string): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(CHAT_READ_CONFIRMED_EVENT, { detail: { shareCode } }));
}

export function useChatUnreadCount(): ChatUnreadSnapshot {
	const { wg, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const chat = useCachedFetch<ChatUnreadCount>(`/api/wg/${encodedShareCode}/chat/unread-count`, {
		memberId: identity.memberId,
		memberToken: identity.memberToken,
	});
	const refresh = useCallback(() => void chat.refresh(), [chat.refresh]);

	useEffect(() => {
		const refreshAfterRead = (event: Event): void => {
			const detail = (event as CustomEvent<{ shareCode?: unknown }>).detail;
			if (detail?.shareCode === wg.shareCode) refresh();
		};
		window.addEventListener(CHAT_READ_CONFIRMED_EVENT, refreshAfterRead);
		return () => window.removeEventListener(CHAT_READ_CONFIRMED_EVENT, refreshAfterRead);
	}, [refresh, wg.shareCode]);

	return { data: chat.data, error: chat.error !== undefined, refresh };
}

function countState<T>(data: T | undefined, error: unknown): SegmentCountState {
	if (data !== undefined) return error ? 'stale' : 'ready';
	return error ? 'unavailable' : 'loading';
}

/** Shared, member-scoped dashboard reads for household and finance counts. */
export function useDashboardCounts(): Record<string, SegmentCount> {
	const { wg, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const dashboard = useCachedFetch<DashboardCountsRead>(`/api/wg/${encodedShareCode}/dashboard`, {
		memberId: identity.memberId,
		memberToken: identity.memberToken,
	});

	const dashboardState = countState(dashboard.data, dashboard.error);
	const ownDueCount = dashboard.data
		? countOwnDueChores(dashboard.data.dueChores, identity.memberId)
		: undefined;
	return {
		einkauf: {
			count: dashboard.data?.openShoppingCount,
			hint: 'offen',
			state: dashboardState,
		},
		putzen: { count: ownDueCount, hint: 'für dich fällig', state: dashboardState },
		abos: {
			count: dashboard.data?.dueRecurringExpenses.length,
			hint: 'fällig',
			state: dashboardState,
		},
	};
}
