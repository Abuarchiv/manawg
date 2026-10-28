import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { wgMembers } from './schema';
import type { DbTransaction } from './transaction';

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
