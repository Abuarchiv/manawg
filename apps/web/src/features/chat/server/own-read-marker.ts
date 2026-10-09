import 'server-only';
import { db, wgChatMessages, wgChatReads } from '@/core/db';
import { and, eq } from 'drizzle-orm';

/** The member's last read message, or null when they never opened the chat. */
export async function loadOwnReadMarker(
	wgId: string,
	memberId: string,
): Promise<{ messageId: string; createdAt: Date } | null> {
	const [marker] = await db
		.select({ messageId: wgChatMessages.id, createdAt: wgChatMessages.createdAt })
		.from(wgChatReads)
		.innerJoin(wgChatMessages, eq(wgChatMessages.id, wgChatReads.lastReadMessageId))
		.where(and(eq(wgChatReads.wgId, wgId), eq(wgChatReads.memberId, memberId)))
		.limit(1);
	return marker ?? null;
}
