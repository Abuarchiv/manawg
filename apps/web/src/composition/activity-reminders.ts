import { MS_PER_DAY, parseTimestamp } from '@/core/utils/time';
import { getChoreStatus } from '@/features/chores/chore-status';
import type { ActivityKind } from './activity-types';

const STALE_SHOPPING_DAYS = 3;
const STALE_ANNOUNCEMENT_DAYS = 2;

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
				detail: 'Prüfe kurz, ob du das noch brauchst.',
			},
		});
	}

	return reminders
		.sort((a, b) => a.priority - b.priority || b.ageDays - a.ageDays)
		.slice(0, 6)
		.map(({ item }) => item);
}

export function buildActivityInbox(input: ActivityInboxInput): ActivityInboxItem[] {
	// Open items only: the user's own completed entries appear below in the history.
	return input.reminders
		.map((item) => ({
			id: `reminder:${item.kind}:${item.href}`,
			priority: 'high' as const,
			title: item.title,
			detail: item.detail,
			href: item.href,
			kind: item.kind,
		}))
		.slice(0, 6);
}
