import { randomBytes } from 'node:crypto';
import { and, count, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { INVITE_VALID_DAYS } from '@/core/utils/invite-token';
import { MS_PER_DAY } from '@/core/utils/time';
import { wgInvites } from './schema-invites';
import { withTransaction } from './transaction';

/** Active (unexpired, unrevoked, not used up) invitations one WG may hold at a time. */
const MAX_ACTIVE_INVITES = 20;
const DEFAULT_INVITE_MAX_USES = 10;

type InviteRow = typeof wgInvites.$inferSelect;
export type InviteStatus = 'valid' | 'expired' | 'revoked' | 'exhausted';

export function inviteStatus(
	invite: Pick<InviteRow, 'expiresAt' | 'revokedAt' | 'useCount' | 'maxUses'>,
	now = new Date(),
): InviteStatus {
	if (invite.revokedAt) return 'revoked';
	if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
	if (invite.useCount >= invite.maxUses) return 'exhausted';
	return 'valid';
}

/** SQL twin of {@link inviteStatus} === 'valid', scoped to one WG. */
export function activeInvitesOf(wgId: string) {
	return and(
		eq(wgInvites.wgId, wgId),
		isNull(wgInvites.revokedAt),
		gt(wgInvites.expiresAt, sql`now()`),
		lt(wgInvites.useCount, wgInvites.maxUses),
	);
}

/**
 * Inserts a 7-day invitation, or `null` when the WG already holds the maximum of active ones.
 * Count and insert run behind a row lock on the WG, so two parallel requests cannot both pass
 * the cap.
 */
export async function createWgInvite(
	wgId: string,
	memberId: string,
): Promise<{ id: string; token: string; expiresAt: Date } | null> {
	return withTransaction(async (tx) => {
		await tx.execute(sql`select id from wgs where id = ${wgId} for update`);
		const [active] = await tx
			.select({ total: count() })
			.from(wgInvites)
			.where(activeInvitesOf(wgId));
		if ((active?.total ?? 0) >= MAX_ACTIVE_INVITES) return null;
		const token = randomBytes(16).toString('base64url');
		const expiresAt = new Date(Date.now() + INVITE_VALID_DAYS * MS_PER_DAY);
		const [invite] = await tx
			.insert(wgInvites)
			.values({
				wgId,
				token,
				createdByMemberId: memberId,
				expiresAt,
				maxUses: DEFAULT_INVITE_MAX_USES,
			})
			.returning({ id: wgInvites.id });
		if (!invite) throw new Error('invite_insert_failed');
		return { id: invite.id, token, expiresAt };
	});
}
