import type {
	Announcement,
	AnnouncementKind,
	AnnouncementSource,
	ReactionKey,
} from '@/features/pinnwand/components/announcement-types';

/** What a Pinnwand card shows, derived from the post; the components only render it. */

export const SOURCE_LABELS: Record<AnnouncementSource, string | null> = {
	manual: null,
	system: 'System',
	chore_swap: 'Putzplan',
	expense: 'Ausgaben',
	shopping: 'Einkauf',
};

export const REACTION_OPTIONS: ReadonlyArray<{ key: ReactionKey; label: string }> = [
	{ key: 'seen', label: 'Gesehen' },
	{ key: 'take', label: 'Übernehme ich' },
	{ key: 'ok', label: 'Passt' },
];

/** The reaction each kind of post asks for; it is always shown on the card. */
const PRIMARY_REACTION: Record<AnnouncementKind, ReactionKey> = {
	info: 'seen',
	question: 'seen',
	problem: 'take',
	request: 'take',
	decision: 'ok',
};

export type ConversionTarget = 'shopping' | 'chore' | 'expense';

export const CONVERSION_TARGETS: ReadonlyArray<{ target: ConversionTarget; label: string }> = [
	{ target: 'shopping', label: 'Als Einkauf' },
	{ target: 'chore', label: 'Als Aufgabe' },
	{ target: 'expense', label: 'Als Ausgabe' },
];

/** Long posts start collapsed to four lines. */
export function isLongAnnouncementBody(text: string): boolean {
	return text.length > 300 || text.split('\n').length > 6;
}

/**
 * Splits the reactions into buttons on the card and entries in the menu. A reaction shows on the
 * card when it is the kind's primary one, used by anyone, or touched by the viewer in this
 * session (so it does not jump into the menu right after being toggled off). Resolved posts
 * cannot be taken.
 */
export function pickReactionOptions(
	announcement: Pick<Announcement, 'kind' | 'status' | 'myReactions' | 'reactionCounts'>,
	touched: readonly ReactionKey[],
): { visible: ReactionKey[]; hidden: ReactionKey[] } {
	const options = REACTION_OPTIONS.map(({ key }) => key).filter(
		(key) => announcement.status !== 'resolved' || key !== 'take',
	);
	const visible = options.filter(
		(key) =>
			key === PRIMARY_REACTION[announcement.kind] ||
			announcement.myReactions.includes(key) ||
			touched.includes(key) ||
			(announcement.reactionCounts[key] ?? 0) > 0,
	);
	return { visible, hidden: options.filter((key) => !visible.includes(key)) };
}
