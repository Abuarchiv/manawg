import {
	MS_PER_DAY,
	formatShortDateRange as formatSharedShortDateRange,
	parseTimestamp,
} from '@/core/utils/time';
import { getChoreStatus } from '@/features/chores/chore-status';
import { auditDetail, formatAuditActivityText, getAuditHref } from './activity-audit';

export {
	type ActivityFilter,
	type ActivityScope,
	buildActivityInbox,
	filterActivityByScope,
	filterActivityItems,
	groupActivityItemsByDay,
} from './activity-views';

const STALE_SHOPPING_DAYS = 3;
const STALE_ANNOUNCEMENT_DAYS = 2;

export type ActivityKind =
	| 'expense'
	| 'shopping'
	| 'announcement'
	| 'chore'
	| 'recurring'
	| 'absence'
	| 'audit';

export interface ActivityItem {
	id: string;
	kind: ActivityKind;
	timestamp: string;
	memberId?: string | null;
	memberName: string;
	text: string;
	completed: boolean;
	detail?: string;
	amountCents?: number;
	currency?: string;
	href?: string;
}

export function activityItemKey(
	item: Pick<ActivityItem, 'kind' | 'timestamp' | 'memberName' | 'text' | 'href'> & {
		id?: string;
	},
	index: number,
): string {
	return (
		item.id ??
		item.href ??
		`${item.kind}:${item.timestamp}:${item.memberName}:${item.text}:${index}`
	);
}

interface MemberInput {
	id: string;
	name: string;
}

interface ActivityTimelineInput {
	members: MemberInput[];
	expenses: Array<{
		id: string;
		paidByMemberId: string;
		description: string;
		amountCents: number;
		currency?: string;
		occurredAt: string;
	}>;
	shoppingItems: Array<{
		id: string;
		addedByMemberId: string;
		name: string;
		createdAt: string;
		boughtAt: string | null;
	}>;
	announcements: Array<{
		id: string;
		authorMemberId: string;
		content: string;
		createdAt: string;
		source: string;
	}>;
	choreCompletions: Array<{
		id: string;
		choreId: string;
		choreTitle: string;
		completedByMemberId: string;
		completedAt: string;
	}>;
	recurringExpenses?: Array<{
		id: string;
		description: string;
		amountCents: number;
		currency?: string;
		paidByMemberId: string;
		createdAt: string;
		lastCreatedAt: string | null;
	}>;
	absences?: Array<{
		id: string;
		memberId: string;
		startDate: string;
		endDate: string;
		reason: string | null;
		createdAt: string;
	}>;
	auditEvents?: Array<{
		id: string;
		memberId: string | null;
		eventType: string;
		entityType?: string;
		entityId?: string | null;
		summary: string;
		metadataJson?: string | null;
		createdAt: string;
	}>;
	limit?: number;
}

export interface ActivityReminder {
	kind: 'shopping' | 'chore' | 'announcement';
	title: string;
	detail: string;
	href: string;
}

interface ActivityReminderInput {
	openShoppingItems: Array<{ id: string; name: string; createdAt: string }>;
	dueChores: Array<{
		id: string;
		title: string;
		nextDueAt: string;
		assignedName: string | null;
	}>;
	openAnnouncements?: Array<{
		id: string;
		content: string;
		kind: string;
		createdAt: string;
	}>;
}

function memberName(members: Map<string, MemberInput>, id: string): string {
	return members.get(id)?.name ?? '—';
}

function shortDateRange(startIso: string, endIso: string): string {
	return formatSharedShortDateRange(startIso, endIso).replace(' bis ', '-');
}

export function buildActivityTimeline(input: ActivityTimelineInput): ActivityItem[] {
	const members = new Map(input.members.map((member) => [member.id, member]));
	const items: ActivityItem[] = [];

	for (const item of input.expenses) {
		items.push({
			id: item.id,
			kind: 'expense',
			timestamp: item.occurredAt,
			memberId: item.paidByMemberId,
			memberName: memberName(members, item.paidByMemberId),
			text: item.description,
			completed: false,
			amountCents: item.amountCents,
			currency: item.currency ?? 'EUR',
			href: `/ausgaben?highlight=${encodeURIComponent(item.id)}`,
		});
	}

	for (const item of input.shoppingItems) {
		items.push({
			id: item.id,
			kind: 'shopping',
			timestamp: item.boughtAt ?? item.createdAt,
			memberId: item.addedByMemberId,
			memberName: memberName(members, item.addedByMemberId),
			text: item.boughtAt ? `${item.name} gekauft` : `${item.name} hinzugefügt`,
			completed: item.boughtAt !== null,
			href: `/einkauf?highlight=${encodeURIComponent(item.id)}`,
		});
	}

	for (const item of input.announcements) {
		items.push({
			id: item.id,
			kind: 'announcement',
			timestamp: item.createdAt,
			memberId: item.authorMemberId,
			memberName: memberName(members, item.authorMemberId),
			text: item.content,
			completed: false,
			href: `/pinnwand#announcement-${encodeURIComponent(item.id)}`,
		});
	}

	for (const item of input.choreCompletions) {
		items.push({
			id: item.id,
			kind: 'chore',
			timestamp: item.completedAt,
			memberId: item.completedByMemberId,
			memberName: memberName(members, item.completedByMemberId),
			text: `${item.choreTitle} erledigt`,
			completed: true,
			href: `/putzen?highlight=${encodeURIComponent(item.choreId)}`,
		});
	}

	for (const item of input.recurringExpenses ?? []) {
		items.push({
			id: item.id,
			kind: 'recurring',
			timestamp: item.lastCreatedAt ?? item.createdAt,
			memberId: item.paidByMemberId,
			memberName: memberName(members, item.paidByMemberId),
			text: item.lastCreatedAt
				? `${item.description} aus Vorlage erstellt`
				: `${item.description} als Fixkosten-Vorlage angelegt`,
			completed: false,
			detail: 'Fixkosten',
			amountCents: item.amountCents,
			currency: item.currency ?? 'EUR',
			href: `/ausgaben?recurring=${encodeURIComponent(item.id)}`,
		});
	}

	for (const item of input.absences ?? []) {
		items.push({
			id: item.id,
			kind: 'absence',
			timestamp: item.createdAt,
			memberId: item.memberId,
			memberName: memberName(members, item.memberId),
			text: 'ist abwesend',
			completed: false,
			detail: item.reason
				? `${shortDateRange(item.startDate, item.endDate)} · ${item.reason}`
				: shortDateRange(item.startDate, item.endDate),
			href: `/putzen?panel=absences&absence=${encodeURIComponent(item.id)}`,
		});
	}

	for (const item of input.auditEvents ?? []) {
		const detail = auditDetail(item.metadataJson);
		const href = getAuditHref(item);
		const actorName = item.memberId ? memberName(members, item.memberId) : 'System';
		items.push({
			id: item.id,
			kind: 'audit',
			timestamp: item.createdAt,
			memberId: item.memberId,
			memberName: actorName,
			text: formatAuditActivityText(item.summary, actorName),
			completed: false,
			...(detail ? { detail } : {}),
			...(href ? { href } : {}),
		});
	}

	return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, input.limit ?? 50);
}

/**
 * Announcement kinds that turn into a reminder once they stay open too long: those the
 * pinnwand lets members close ("Erledigt"). Infos and decisions fade out on their own.
 */
export const REMINDER_ANNOUNCEMENT_KINDS = ['question', 'problem', 'request'] as const;

export function getActivityReminders(
	input: ActivityReminderInput,
	now = Date.now(),
): ActivityReminder[] {
	const reminders: Array<{ item: ActivityReminder; priority: number; ageDays: number }> = [];

	for (const chore of input.dueChores) {
		const status = getChoreStatus(chore.nextDueAt, now);
		if (!status.escalated) continue;
		reminders.push({
			priority: 0,
			ageDays: status.overdueDays,
			item: {
				kind: 'chore',
				title: `${chore.title} hängt seit ${status.overdueDays} Tagen`,
				href: `/putzen?highlight=${encodeURIComponent(chore.id)}`,
				detail: `${chore.assignedName ?? 'Niemand'} ist eingetragen. Nachholen, übernehmen oder kurz klären.`,
			},
		});
	}

	for (const item of input.openAnnouncements ?? []) {
		if (!(REMINDER_ANNOUNCEMENT_KINDS as readonly string[]).includes(item.kind)) continue;
		const createdAt = parseTimestamp(item.createdAt);
		if (createdAt === null) continue;
		const days = Math.floor((now - createdAt) / MS_PER_DAY);
		if (days < STALE_ANNOUNCEMENT_DAYS) continue;
		reminders.push({
			priority: 1,
			ageDays: days,
			item: {
				kind: 'announcement',
				title: `Pinnwand offen seit ${days} Tagen`,
				href: `/pinnwand#announcement-${encodeURIComponent(item.id)}`,
				detail: item.content,
			},
		});
	}

	for (const item of input.openShoppingItems) {
		const createdAt = parseTimestamp(item.createdAt);
		if (createdAt === null) continue;
		const days = Math.floor((now - createdAt) / MS_PER_DAY);
		if (days < STALE_SHOPPING_DAYS) continue;
		reminders.push({
			priority: 2,
			ageDays: days,
			item: {
				kind: 'shopping',
				title: `${item.name} liegt seit ${days} Tagen offen`,
				href: `/einkauf?highlight=${encodeURIComponent(item.id)}`,
				detail: 'Prüft kurz, ob ihr das noch braucht.',
			},
		});
	}

	return reminders
		.sort((a, b) => a.priority - b.priority || b.ageDays - a.ageDays)
		.slice(0, 6)
		.map(({ item }) => item);
}
