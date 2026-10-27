import { db } from '@/core/db';
import { logApiError } from '@/core/infra/observability';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { auditEvents, wgMembers, wgs } from './schema';
import { type DbTransaction, lockExpensePayments, withTransaction } from './transaction';

const WGS_PER_RUN = 50;

type Successor = { id: string; name: string };

/**
 * Makes sure a WG has an admin who can sign in. When no active admin with an
 * account exists, the stale admin row (a placeholder or a moved-out member) is
 * demoted first, which keeps the one-admin-per-WG index satisfied, and the
 * longest-standing active member with an account is promoted.
 *
 * The caller holds `lockExpensePayments` for the WG, the same lock every role
 * writer takes. Returns the promoted member, or null when nothing changed.
 */
export async function ensureWgAdmin(tx: DbTransaction, wgId: string): Promise<Successor | null> {
	const [usable] = await tx
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(
			and(
				eq(wgMembers.wgId, wgId),
				eq(wgMembers.role, 'admin'),
				isNull(wgMembers.deactivatedAt),
				isNotNull(wgMembers.authUserId),
			),
		)
		.limit(1);
	if (usable) return null;
	const [successor] = await tx
		.select({ id: wgMembers.id, name: wgMembers.name })
		.from(wgMembers)
		.where(
			and(
				eq(wgMembers.wgId, wgId),
				isNull(wgMembers.deactivatedAt),
				// An unlinked row could never act as admin.
				isNotNull(wgMembers.authUserId),
			),
		)
		.orderBy(asc(wgMembers.createdAt), asc(wgMembers.id))
		.limit(1);
	if (!successor) return null;
	await tx
		.update(wgMembers)
		.set({ role: 'member' })
		.where(and(eq(wgMembers.wgId, wgId), eq(wgMembers.role, 'admin')));
	await tx.update(wgMembers).set({ role: 'admin' }).where(eq(wgMembers.id, successor.id));
	return successor;
}

function activeMemberWithAccount(): ReturnType<typeof sql> {
	return sql`${wgMembers.wgId} = ${wgs.id} and ${wgMembers.deactivatedAt} is null and ${wgMembers.authUserId} is not null`;
}

/**
 * Repairs WGs whose admin cannot sign in (legacy placeholder admins, accounts
 * deleted before the handover existed). Each WG is fixed in its own transaction
 * with the account-deletion lock order; the check repeats under the lock, so a
 * WG that changed in the meantime is left alone.
 */
export async function healAdminlessWgs(): Promise<{ healed: number; failed: number }> {
	const candidates = await db
		.select({ id: wgs.id })
		.from(wgs)
		.where(
			sql`exists (select 1 from ${wgMembers} where ${activeMemberWithAccount()})
				and not exists (select 1 from ${wgMembers} where ${activeMemberWithAccount()} and ${wgMembers.role} = 'admin')`,
		)
		.orderBy(asc(wgs.id))
		.limit(WGS_PER_RUN);
	let healed = 0;
	let failed = 0;
	for (const { id: wgId } of candidates) {
		try {
			const successor = await withTransaction(async (tx) => {
				await lockExpensePayments(tx, wgId);
				await tx.select({ id: wgs.id }).from(wgs).where(eq(wgs.id, wgId)).for('update');
				const promoted = await ensureWgAdmin(tx, wgId);
				if (promoted) {
					await tx.insert(auditEvents).values({
						wgId,
						memberId: null,
						eventType: 'member.admin_transferred',
						entityType: 'member',
						entityId: promoted.id,
						summary: `${promoted.name} ist jetzt Admin, weil kein aktives Mitglied mit Konto die Rolle hatte.`,
						metadataJson: JSON.stringify({ name: promoted.name }),
					});
				}
				return promoted;
			});
			if (successor) healed += 1;
		} catch (err) {
			logApiError('[maintenance] admin handover failed for one WG', err);
			failed += 1;
		}
	}
	return { healed, failed };
}
