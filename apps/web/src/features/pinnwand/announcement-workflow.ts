export const ANNOUNCEMENT_KINDS = ['info', 'question', 'problem', 'request', 'decision'] as const;
export const ANNOUNCEMENT_SOURCES = [
	'manual',
	'system',
	'chore_swap',
	'expense',
	'shopping',
] as const;
export const ANNOUNCEMENT_REACTIONS = ['seen', 'take', 'ok'] as const;

export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];
export type AnnouncementSource = (typeof ANNOUNCEMENT_SOURCES)[number];
type AnnouncementReactionKey = (typeof ANNOUNCEMENT_REACTIONS)[number];
export type AnnouncementStatus = 'open' | 'resolved';
export type AnnouncementKindFilter = AnnouncementKind | 'all';
export type AnnouncementStatusFilter = AnnouncementStatus | 'all';
export type AnnouncementOwnershipFilter = 'all' | 'mine' | 'untaken';

export interface AnnouncementFilter {
	status: AnnouncementStatusFilter;
	kind: AnnouncementKindFilter;
	pinnedOnly: boolean;
	query?: string;
	ownership?: AnnouncementOwnershipFilter;
	currentMemberId?: string | null;
}

interface AnnouncementReactionInput {
	announcementId: string;
	memberId: string;
	reaction: string;
}

interface AnnouncementReactionSummary {
	reactionCounts: Partial<Record<AnnouncementReactionKey, number>>;
	myReactions: AnnouncementReactionKey[];
}

export function getAnnouncementHash(id: string): string {
	return `#announcement-${encodeURIComponent(id)}`;
}

function isAnnouncementReaction(value: string): value is AnnouncementReactionKey {
	return (ANNOUNCEMENT_REACTIONS as readonly string[]).includes(value);
}

export function summarizeAnnouncementReactions(
	reactions: readonly AnnouncementReactionInput[],
	currentMemberId: string | null,
): Map<string, AnnouncementReactionSummary> {
	const summary = new Map<string, AnnouncementReactionSummary>();

	for (const reaction of reactions) {
		if (!isAnnouncementReaction(reaction.reaction)) continue;

		const entry = summary.get(reaction.announcementId) ?? {
			reactionCounts: {},
			myReactions: [],
		};
		entry.reactionCounts[reaction.reaction] = (entry.reactionCounts[reaction.reaction] ?? 0) + 1;
		if (currentMemberId && reaction.memberId === currentMemberId) {
			entry.myReactions.push(reaction.reaction);
		}
		summary.set(reaction.announcementId, entry);
	}

	return summary;
}

export function filterAnnouncements<
	T extends {
		content?: string;
		kind: string;
		status: string;
		pinnedAt: string | null;
		takers?: readonly { memberId: string }[];
	},
>(items: readonly T[], filter: AnnouncementFilter): T[] {
	const query = filter.query?.trim().toLocaleLowerCase('de-DE') ?? '';
	const ownership = filter.ownership ?? 'all';

	return items.filter((item) => {
		if (filter.status !== 'all' && item.status !== filter.status) return false;
		if (filter.kind !== 'all' && item.kind !== filter.kind) return false;
		if (filter.pinnedOnly && !item.pinnedAt) return false;
		if (query && !item.content?.toLocaleLowerCase('de-DE').includes(query)) return false;
		if (
			ownership === 'mine' &&
			(!filter.currentMemberId ||
				!item.takers?.some((taker) => taker.memberId === filter.currentMemberId))
		) {
			return false;
		}
		if (ownership === 'untaken' && (item.takers?.length ?? 0) > 0) return false;
		return true;
	});
}

export function getMyOpenAnnouncements<
	T extends { status: string; myReactions: readonly string[] },
>(items: readonly T[]): T[] {
	return items.filter((item) => item.status !== 'resolved' && item.myReactions.includes('take'));
}

export function getNewAnnouncementCount(
	currentItems: readonly { id: string }[],
	remoteItems: readonly { id: string }[],
): number {
	const currentIds = new Set(currentItems.map((item) => item.id));
	return remoteItems.filter((item) => !currentIds.has(item.id)).length;
}

export function reconcilePendingAnnouncements<T extends { id: string }>(
	currentItems: readonly { id: string }[],
	remoteItems: readonly T[],
	serverRevision: number,
	lastProcessedServerRevision: number,
): { items: T[]; count: number; serverRevision: number } | null {
	if (serverRevision <= lastProcessedServerRevision) return null;
	return {
		items: [...remoteItems],
		count: currentItems.length > 0 ? getNewAnnouncementCount(currentItems, remoteItems) : 0,
		serverRevision,
	};
}

/**
 * Refresh already-visible announcements in place from a background poll,
 * without inserting or reordering rows (new posts stay gated behind the
 * "N new posts" banner via `getNewAnnouncementCount`, so a growing list never
 * jumps under the reader). Posts missing from the server response are removed.
 * Without this, a background poll that finds no
 * brand-new post silently drops the whole response — reactions, comments,
 * taker lists and resolved status on already-loaded posts would never
 * update on their own, only on a manual reload or full refresh.
 */
export function mergeBackgroundAnnouncements<T extends { id: string }>(
	currentItems: readonly T[],
	remoteItems: readonly T[],
): T[] {
	const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
	return currentItems.flatMap((item) => {
		const remoteItem = remoteById.get(item.id);
		return remoteItem ? [remoteItem] : [];
	});
}
