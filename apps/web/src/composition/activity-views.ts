/** Client-side views over activity items: filters, day groups and the inbox. */
import { berlinDayKey, prevBerlinDayStart, startOfBerlinDay } from '@/core/utils/berlin-day';
import type { ActivityItem, ActivityKind, ActivityReminder } from './activity';

export interface ActivityFilter {
	kind: ActivityKind | 'all';
	mineOnly: boolean;
	query: string;
}

export type ActivityScope = 'all' | 'system' | 'mine' | 'changes' | 'done';

interface ActivityChronicleGroup {
	date: string;
	label: string;
	items: ActivityItem[];
}

interface ActivityInboxItem {
	id: string;
	priority: 'high' | 'normal';
	title: string;
	detail: string;
	href: string;
	kind: ActivityKind | ActivityReminder['kind'];
}

interface ActivityInboxInput {
	reminders: ActivityReminder[];
	items: ActivityItem[];
	currentMemberName: string;
	currentMemberId?: string | null;
}

function isCurrentMemberActivity(
	item: ActivityItem,
	currentMemberName: string,
	currentMemberId?: string | null,
): boolean {
	if (currentMemberId && item.memberId) return item.memberId === currentMemberId;
	return item.memberName === currentMemberName;
}

export function filterActivityItems(
	items: ActivityItem[],
	filter: ActivityFilter,
	currentMemberName: string,
	currentMemberId?: string | null,
): ActivityItem[] {
	const query = filter.query.trim().toLocaleLowerCase('de-DE');
	return items.filter((item) => {
		if (filter.kind !== 'all' && item.kind !== filter.kind) return false;
		if (filter.mineOnly && !isCurrentMemberActivity(item, currentMemberName, currentMemberId))
			return false;
		if (!query) return true;
		return `${item.memberName} ${item.text} ${item.detail ?? ''}`
			.toLocaleLowerCase('de-DE')
			.includes(query);
	});
}

export function filterActivityByScope(
	items: ActivityItem[],
	scope: ActivityScope,
	currentMemberName: string,
	currentMemberId?: string | null,
): ActivityItem[] {
	if (scope === 'all') return items;
	return items.filter((item) => {
		const done = item.completed || /erledigt|gekauft|bezahlt/i.test(item.text);
		const system = item.memberName === 'System';
		if (scope === 'system') return system;
		if (scope === 'mine') return isCurrentMemberActivity(item, currentMemberName, currentMemberId);
		if (scope === 'done') return done;
		if (scope === 'changes') return !done;
		return true;
	});
}

export function groupActivityItemsByDay(
	items: ActivityItem[],
	now = Date.now(),
): ActivityChronicleGroup[] {
	const formatter = new Intl.DateTimeFormat('de-DE', {
		weekday: 'short',
		day: '2-digit',
		month: '2-digit',
		timeZone: 'Europe/Berlin',
	});
	// Group by Berlin calendar day so entries around midnight land under the
	// label the user actually sees (labels are formatted in Berlin time).
	const todayKey = berlinDayKey(new Date(now));
	// Not `now - 24h`: on the day after spring-forward (23h) that lands two days back.
	const yesterdayKey = berlinDayKey(prevBerlinDayStart(startOfBerlinDay(new Date(now))));
	const groups = new Map<string, ActivityItem[]>();

	for (const item of items) {
		const key = berlinDayKey(new Date(item.timestamp));
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}

	return Array.from(groups.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([date, groupItems]) => ({
			date,
			label:
				date === todayKey
					? 'Heute'
					: date === yesterdayKey
						? 'Gestern'
						: formatter.format(new Date(`${date}T12:00:00.000Z`)),
			items: groupItems,
		}));
}

function inboxActivityDetail(kind: ActivityKind): string {
	switch (kind) {
		case 'expense':
			return 'Deine Ausgabe';
		case 'shopping':
			return 'Dein Einkauf';
		case 'announcement':
			return 'Dein Pinnwand-Beitrag';
		case 'chore':
			return 'Von dir erledigt';
		case 'recurring':
			return 'Deine Fixkosten';
		case 'absence':
			return 'Deine Abwesenheit';
		case 'audit':
			return 'Deine Änderung';
	}
}

export function buildActivityInbox(input: ActivityInboxInput): ActivityInboxItem[] {
	const urgent = input.reminders.map((item) => ({
		id: `reminder:${item.kind}:${item.href}`,
		priority: 'high' as const,
		title: item.title,
		detail: item.detail,
		href: item.href,
		kind: item.kind,
	}));
	const mine = input.items
		.filter(
			(item) =>
				isCurrentMemberActivity(item, input.currentMemberName, input.currentMemberId) && item.href,
		)
		.slice(0, 4)
		.map((item) => ({
			id: `activity:${item.kind}:${item.id}`,
			priority: 'normal' as const,
			// Log texts start with „hat“/„ist“ and need the person in front (as in ActivityFeed).
			title: item.text.replace(/^hat\b/, 'Du hast').replace(/^ist\b/, 'Du bist'),
			detail: inboxActivityDetail(item.kind),
			href: item.href ?? '',
			kind: item.kind,
		}));

	return [...urgent, ...mine].slice(0, 6);
}
