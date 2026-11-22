import { eq, sql } from 'drizzle-orm';
import { db, wgInvites, wgMembers, wgs } from '@/core/db';
import { inviteStatus } from '@/core/db/wg-invites';
import { type InvitePreview, isInviteToken } from '@/core/utils/invite-token';

/**
 * The first word of a display name: the invitation names a person, not the full entry. A first
 * word that ends in a dot is a title or an initial ("Dr. Mika"), which reads wrong alone, so the
 * caller falls back to the wording without a name.
 */
function firstName(name: string | null): string | null {
	const word = name?.trim().split(/\s+/)[0];
	return word && !word.endsWith('.') ? word : null;
}

/**
 * The preview of a usable invitation: the WG name, the first name of the inviter (null when they
 * have none or moved out) and the number of active members. Every token that cannot be used
 * (malformed, unknown, expired, revoked, used up) gives null, so callers cannot tell those cases
 * apart. A read-only lookup: it needs no session and leaves `use_count` alone. No ids, share code
 * or member names leave here. Database errors propagate.
 */
export async function findInvitePreview(token: string): Promise<InvitePreview | null> {
	if (!isInviteToken(token)) return null;
	const [row] = await db
		.select({
			wgName: wgs.name,
			inviterName: wgMembers.name,
			inviterDeactivatedAt: wgMembers.deactivatedAt,
			expiresAt: wgInvites.expiresAt,
			revokedAt: wgInvites.revokedAt,
			useCount: wgInvites.useCount,
			maxUses: wgInvites.maxUses,
			memberCount: sql<number>`(select count(*)::int from ${wgMembers} where ${wgMembers.wgId} = ${wgInvites.wgId} and ${wgMembers.deactivatedAt} is null)`,
		})
		.from(wgInvites)
		.innerJoin(wgs, eq(wgs.id, wgInvites.wgId))
		.leftJoin(wgMembers, eq(wgMembers.id, wgInvites.createdByMemberId))
		.where(eq(wgInvites.token, token))
		.limit(1);
	if (!row || inviteStatus(row) !== 'valid') return null;
	return {
		wgName: row.wgName,
		inviterName: row.inviterDeactivatedAt ? null : firstName(row.inviterName),
		memberCount: row.memberCount,
	};
}
