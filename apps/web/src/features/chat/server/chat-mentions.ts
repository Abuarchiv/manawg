import 'server-only';
import { eq } from 'drizzle-orm';
import { wgChatMentions, wgMembers } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import { findMentions } from '@/features/chat/chat-text';

/**
 * The members a message body mentions: those whose "@Name" appears in the body, same matcher as
 * the composer (longest name first, the sender never mentions themself). Member names are unique
 * per WG (`wg_members_unique_name_per_wg`), so a name always resolves to exactly one member.
 * With `requestedMemberIds` (a client's list) only those members are kept, so a client cannot
 * ping someone its text does not name; without it every named member counts.
 */
export async function resolveMentionIds(
	tx: DbTransaction,
	input: {
		wgId: string;
		senderMemberId: string;
		body: string | null;
		requestedMemberIds?: readonly string[];
	},
): Promise<string[]> {
	if (!input.body) return [];
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
	const requested = input.requestedMemberIds && new Set(input.requestedMemberIds);
	return members
		.filter(
			(member) =>
				matchedNames.has(member.name) &&
				member.id !== input.senderMemberId &&
				(!requested || requested.has(member.id)),
		)
		.map((member) => member.id);
}

/** Replaces the mention rows of an edited message with the "@Name" mentions in its new text. */
export async function replaceMessageMentions(
	tx: DbTransaction,
	input: { wgId: string; messageId: string; senderMemberId: string; body: string },
): Promise<void> {
	const mentionIds = await resolveMentionIds(tx, input);
	await tx.delete(wgChatMentions).where(eq(wgChatMentions.messageId, input.messageId));
	if (mentionIds.length === 0) return;
	await tx
		.insert(wgChatMentions)
		.values(
			mentionIds.map((mentionedMemberId) => ({ messageId: input.messageId, mentionedMemberId })),
		)
		.onConflictDoNothing();
}
