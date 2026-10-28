'use client';

import { useLocale } from 'next-intl';
import { useMemo } from 'react';
import type { DashboardData } from '@/composition/dashboard-data';
import { getForYouItems, getWeekAgenda } from '@/composition/dashboard-insights';
import { getDashboardAnnouncementHref } from '@/composition/dashboard-links';
import { completionRequestKey } from '@/features/chores/chore-completion';
import type { EventOccurrence } from '@/features/events/events';
import type { Locale } from '@/shared/i18n/locale';

type PendingAnnouncement = DashboardData['myOpenAnnouncements'][number];
type LatestAnnouncement = NonNullable<DashboardData['latestAnnouncement']>;

function samePendingAnnouncement(
	announcement: LatestAnnouncement,
	pending: PendingAnnouncement,
	currentMemberName: string,
): boolean {
	if (announcement.id && announcement.id === pending.id) return true;
	return (
		!announcement.id &&
		announcement.authorName === currentMemberName &&
		announcement.content === pending.content
	);
}

/** Activity without what "Für dich" or the latest-announcement card already show. */
function filterActivity(
	data: DashboardData,
	shareCode: string,
	pendingHrefs: ReadonlySet<string>,
): DashboardData['activity'] {
	const latest = data.latestAnnouncement;
	return data.activity
		.filter((item) => !item.href || !pendingHrefs.has(item.href))
		.filter((item) => {
			if (!latest || item.kind !== 'announcement') return true;
			if (latest.id) return item.href !== getDashboardAnnouncementHref(shareCode, latest.id);
			return item.text !== latest.content || item.memberName !== latest.authorName;
		})
		.slice(0, latest ? 2 : 3);
}

interface HomeViewInput {
	data: DashboardData | null;
	eventOccurrences: EventOccurrence[];
	agendaNow: number;
	shareCode: string;
	memberId: string;
	memberName: string;
	/** Chore occurrences completed offline; they stay hidden until the server has them. */
	queuedOccurrences: ReadonlySet<string>;
}

/** Derives the start page sections from the dashboard read. */
export function useHomeView({
	data,
	eventOccurrences,
	agendaNow,
	shareCode,
	memberId,
	memberName,
	queuedOccurrences,
}: HomeViewInput) {
	const locale = useLocale() as Locale;
	const dueChores = useMemo(
		() =>
			(data?.dueChores ?? []).filter(
				(chore) => !queuedOccurrences.has(completionRequestKey(chore)),
			),
		[data?.dueChores, queuedOccurrences],
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
	const latestAnnouncement = data?.latestAnnouncement;
	const latestIsPending = Boolean(
		latestAnnouncement &&
			(data?.myOpenAnnouncements ?? []).some((item) =>
				samePendingAnnouncement(latestAnnouncement, item, memberName),
			),
	);
	const pendingHrefs = useMemo(() => new Set(forYouItems.map((item) => item.href)), [forYouItems]);
	const activityItems = useMemo(
		() => (data ? filterActivity(data, shareCode, pendingHrefs) : []),
		[data, pendingHrefs, shareCode],
	);
	const isNewWg = Boolean(
		data &&
			!data.setup.hasExpense &&
			!data.setup.hasShoppingItem &&
			!data.setup.hasAnnouncement &&
			data.setup.choreCount === 0 &&
			forYouItems.length === 0,
	);
	return { forYouItems, weekAgenda, latestAnnouncement, latestIsPending, activityItems, isNewWg };
}
