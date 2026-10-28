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
	/** `text` for the reader's own rows ("hast … gekauft"); absent when it reads the same. */
	selfText?: string;
	/** True when `text` is a server-built sentence ("hat …"), not user content. */
	sentence?: boolean;
	completed: boolean;
	detail?: string;
	amountCents?: number;
	currency?: string;
	href?: string;
}

export interface ActivityFilter {
	kind: ActivityKind | 'all';
	mineOnly: boolean;
	query: string;
}
