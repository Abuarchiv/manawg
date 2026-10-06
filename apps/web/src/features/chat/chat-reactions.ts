import type { ChatReactionRow, ReactionSummary } from './chat-types';

/** Groups reaction rows per message and emoji, most used emoji first. */
export function summarizeReactions(
	rows: readonly ChatReactionRow[],
	currentMemberId: string,
): Map<string, ReactionSummary[]> {
	const byMessage = new Map<string, Map<string, { count: number; mine: boolean }>>();
	for (const row of rows) {
		const messageMap = byMessage.get(row.messageId) ?? new Map();
		const entry = messageMap.get(row.emoji) ?? { count: 0, mine: false };
		entry.count += 1;
		if (row.memberId === currentMemberId) entry.mine = true;
		messageMap.set(row.emoji, entry);
		byMessage.set(row.messageId, messageMap);
	}
	const result = new Map<string, ReactionSummary[]>();
	for (const [messageId, emojiMap] of byMessage) {
		const list: ReactionSummary[] = [];
		for (const [emoji, { count, mine }] of emojiMap) {
			list.push({ emoji, count, mine });
		}
		list.sort((a, b) => b.count - a.count);
		result.set(messageId, list);
	}
	return result;
}

/** The rows after the viewer's own reaction was confirmed as added or removed. */
export function withOwnReaction(
	rows: ChatReactionRow[],
	kind: 'add' | 'remove',
	own: ChatReactionRow,
): ChatReactionRow[] {
	const isOwnRow = (row: ChatReactionRow) =>
		row.messageId === own.messageId && row.memberId === own.memberId && row.emoji === own.emoji;
	if (kind === 'remove') return rows.filter((row) => !isOwnRow(row));
	return rows.some(isOwnRow) ? rows : [...rows, own];
}
