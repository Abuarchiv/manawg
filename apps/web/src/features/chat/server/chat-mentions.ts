import 'server-only';
import { eq } from 'drizzle-orm';
import { wgChatMentions, wgMembers } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import { findMentions } from '@/features/chat/chat-text';

/**
 * Replaces the mention rows of an edited message with the "@Name" mentions in its new text,
 * same matcher as the composer (longest name first, the sender never mentions themself).
 */
export async function replaceMessageMentions(
	tx: DbTransaction,
	input: { wgId: string; messageId: string; senderMemberId: string; body: string },
): Promise<void> {
	const members = await tx
		.select({ id: wgMembers.id, name: wgMembers.name })
		.from(wgMembers)
		.where(eq(wgMembers.wgId, input.wgId));
	const matchedNames = new Set(
		findMentions(
			input.body,
			members.map((member) => member.name),
		).map((match) => match.name),
	);
	const mentionIds = members
		.filter((member) => matchedNames.has(member.name) && member.id !== input.senderMemberId)
		.map((member) => member.id);
	await tx.delete(wgChatMentions).where(eq(wgChatMentions.messageId, input.messageId));
	if (mentionIds.length === 0) return;
	await tx
		.insert(wgChatMentions)
		.values(
			mentionIds.map((mentionedMemberId) => ({ messageId: input.messageId, mentionedMemberId })),
		)
		.onConflictDoNothing();
}
