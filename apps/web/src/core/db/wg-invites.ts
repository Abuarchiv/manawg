import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { INVITE_VALID_DAYS } from '@/core/utils/invite-token';
import { MS_PER_DAY } from '@/core/utils/time';
import { MAX_ACTIVE_INVITES } from '@/shared/lib/limits';
import { wgMembers } from './schema';
import { wgInvites } from './schema-invites';
import { type DbTransaction, withTransaction } from './transaction';

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

/** The WG home's invite card shows the newest invitation only while it still works. */
export function needsFreshInvite(
	newest: Pick<InviteRow, 'expiresAt' | 'revokedAt' | 'useCount' | 'maxUses'> | null,
	now = new Date(),
): boolean {
	return !newest || inviteStatus(newest, now) !== 'valid';
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

type CreatedInvite = { id: string; token: string; expiresAt: Date };

/** Count and insert behind the WG row lock the caller already holds. */
async function insertInvite(
	tx: DbTransaction,
	wgId: string,
	memberId: string,
): Promise<CreatedInvite | null> {
	const [active] = await tx.select({ total: count() }).from(wgInvites).where(activeInvitesOf(wgId));
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
}

async function lockWg(tx: DbTransaction, wgId: string): Promise<void> {
	await tx.execute(sql`select id from wgs where id = ${wgId} for update`);
}

/**
 * Inserts a 14-day invitation, or `null` when the WG already holds the maximum of active ones.
 * Count and insert run behind a row lock on the WG, so two parallel requests cannot both pass
 * the cap.
 */
export async function createWgInvite(
	wgId: string,
	memberId: string,
): Promise<CreatedInvite | null> {
	return withTransaction(async (tx) => {
		await lockWg(tx, wgId);
		return insertInvite(tx, wgId, memberId);
	});
}

export type SoloInvite =
	| { status: 'not_solo' }
	| { status: 'limit_reached' }
	| { status: 'ok'; invite: CreatedInvite; fresh: boolean };

/**
 * The invite card of a WG with exactly one active member: its newest invitation, or a fresh one
 * (same defaults as the invite screen) once that one has expired, been used up or revoked. Runs
 * behind the WG row lock, so two tabs opening the card at once create one link, not two.
 */
export async function currentSoloInvite(wgId: string, memberId: string): Promise<SoloInvite> {
	return withTransaction(async (tx) => {
		await lockWg(tx, wgId);
		const [members] = await tx
			.select({ total: count() })
			.from(wgMembers)
			.where(and(eq(wgMembers.wgId, wgId), isNull(wgMembers.deactivatedAt)));
		if ((members?.total ?? 0) !== 1) return { status: 'not_solo' };
		const [newest] = await tx
			.select({
				id: wgInvites.id,
				token: wgInvites.token,
				expiresAt: wgInvites.expiresAt,
				revokedAt: wgInvites.revokedAt,
				useCount: wgInvites.useCount,
				maxUses: wgInvites.maxUses,
			})
			.from(wgInvites)
			.where(eq(wgInvites.wgId, wgId))
			.orderBy(desc(wgInvites.createdAt))
			.limit(1);
		if (newest && !needsFreshInvite(newest)) {
			return {
				status: 'ok',
				invite: { id: newest.id, token: newest.token, expiresAt: newest.expiresAt },
				fresh: false,
			};
		}
		const invite = await insertInvite(tx, wgId, memberId);
		return invite ? { status: 'ok', invite, fresh: true } : { status: 'limit_reached' };
	});
}
