'use client';

import { useLocale } from 'next-intl';
import { useMemo } from 'react';
import { ACTIVITY_LIMIT } from '@/composition/activity-types';
import type { DashboardData } from '@/composition/dashboard-data';
import { getForYouItems, getWeekAgenda } from '@/composition/dashboard-insights';
import { completionRequestKey } from '@/features/chores/chore-completion';
import type { EventOccurrence } from '@/features/events/events';
import type { Locale } from '@/shared/i18n/locale';

interface HomeViewInput {
	data: DashboardData | null;
	eventOccurrences: EventOccurrence[];
	agendaNow: number;
	shareCode: string;
	memberId: string;
	/** Server time of the last start-page visit in ms; `null` without a marker, `undefined` while unread. */
	lastSeen: number | null | undefined;
	/** Chore occurrences completed here, offline or just now; they stay hidden until the server has them. */
	hiddenOccurrences: ReadonlySet<string>;
}

/** Derives the start page sections from the dashboard read. */
export function useHomeView({
	data,
	eventOccurrences,
	agendaNow,
	shareCode,
	memberId,
	lastSeen,
	hiddenOccurrences,
}: HomeViewInput) {
	const locale = useLocale() as Locale;
	const dueChores = useMemo(
		() =>
			(data?.dueChores ?? []).filter(
				(chore) => !hiddenOccurrences.has(completionRequestKey(chore)),
			),
		[data?.dueChores, hiddenOccurrences],
	);
	const forYouItems = useMemo(
		() =>
			data
				? getForYouItems({
						shareCode,
						currentMemberId: memberId,
						openShoppingCount: data.openShoppingCount,
						openShoppingTop: data.openShoppingTop,
						dueChores,
						myOpenAnnouncements: data.myOpenAnnouncements,
						dueRecurringExpenses: data.dueRecurringExpenses,
						absentMembers: data.absentMembers,
						balances: data.balances,
						locale,
					})
				: [],
		[data, dueChores, locale, memberId, shareCode],
	);
	const weekAgenda = useMemo(
		() =>
			getWeekAgenda({
				shareCode,
				currentMemberId: memberId,
				dueChores,
				events: eventOccurrences,
				now: agendaNow,
				locale,
			}),
		[dueChores, eventOccurrences, agendaNow, locale, memberId, shareCode],
	);
	const pendingHrefs = useMemo(() => new Set(forYouItems.map((item) => item.href)), [forYouItems]);
	// Others' entries since the last visit, newest first; what "Für dich" already lists stays out.
	const { newItems, newItemsTruncated } = useMemo(() => {
		if (!data || !lastSeen) return { newItems: [], newItemsTruncated: false };
		const isNew = (item: DashboardData['activity'][number]) =>
			Date.parse(item.timestamp) > lastSeen;
		return {
			newItems: data.activity.filter(
				(item) =>
					item.memberId !== memberId && isNew(item) && (!item.href || !pendingHrefs.has(item.href)),
			),
			// A full payload that is new all the way down may have left further new entries out.
			newItemsTruncated: data.activity.length >= ACTIVITY_LIMIT && data.activity.every(isNew),
		};
	}, [data, lastSeen, memberId, pendingHrefs]);
	const isNewWg = Boolean(
		data &&
			!data.setup.hasExpense &&
			!data.setup.hasShoppingItem &&
			!data.setup.hasAnnouncement &&
			data.setup.choreCount === 0 &&
			forYouItems.length === 0,
	);
	return { forYouItems, weekAgenda, newItems, newItemsTruncated, isNewWg };
}
