export type ActivityKind =
	| 'expense'
	| 'shopping'
	| 'announcement'
	| 'chore'
	| 'recurring'
	| 'absence'
	| 'audit';

/** Most rows the dashboard payload carries; a full list may have older rows left out. */
export const ACTIVITY_LIMIT = 6;

export interface ActivityItem {
	id: string;
	kind: ActivityKind;
	timestamp: string;
	memberId?: string | null;
	memberName: string;
	text: string;
	/** `text` for the reader's own rows ("hast … gekauft"); absent when it reads the same. */
	selfText?: string;
	/** True when `text` is a server-built sentence ("hat …"), not user content. */
	sentence?: boolean;
	detail?: string;
	amountCents?: number;
	currency?: string;
	href?: string;
}

/** A feed row as the dashboard and the feed list show it; only the full chronicle guarantees an id. */
export type FeedActivityItem = Omit<ActivityItem, 'id'> & { id?: string };

export interface ActivityFilter {
	kind: ActivityKind | 'all';
	mineOnly: boolean;
	query: string;
}
