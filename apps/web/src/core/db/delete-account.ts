import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { deleteWgCascade } from './delete-wg';
import { pushSubscriptions, wgMembers } from './schema';
import type { DbTransaction } from './transaction';

export type LeftWg = { wgId: string; memberId: string; name: string; newAdminId: string | null };

/**
 * Detaches an auth user from every WG before the account is deleted. The
 * member moves out like an "Auszug": history and balances stay with the WG,
 * the login link, push subscriptions and PayPal id are removed, and an admin
 * hands the role to the longest-standing active flatmate (preferring one who
 * can sign in). A WG with no other active member is deleted entirely.
 */
export async function removeAccountFromWgs(
	tx: DbTransaction,
	authUserId: string,
): Promise<{ left: LeftWg[]; deletedWgIds: string[] }> {
	const memberships = await tx
		.select({ id: wgMembers.id, wgId: wgMembers.wgId, name: wgMembers.name, role: wgMembers.role })
		.from(wgMembers)
		.where(eq(wgMembers.authUserId, authUserId))
		.for('update');
	const left: LeftWg[] = [];
	const deletedWgIds: string[] = [];
	for (const membership of memberships) {
		const [successor] = await tx
			.select({ id: wgMembers.id })
			.from(wgMembers)
			.where(
				and(
					eq(wgMembers.wgId, membership.wgId),
					ne(wgMembers.id, membership.id),
					isNull(wgMembers.deactivatedAt),
				),
			)
			.orderBy(sql`${wgMembers.authUserId} is null`, asc(wgMembers.createdAt))
			.limit(1);
		if (!successor) {
			await deleteWgCascade(tx, membership.wgId);
			deletedWgIds.push(membership.wgId);
			continue;
		}
		await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.memberId, membership.id));
		await tx
			.update(wgMembers)
			.set({
				authUserId: null,
				role: 'member',
				deactivatedAt: sql`coalesce(${wgMembers.deactivatedAt}, now())`,
				paypalMerchantId: null,
				pushOptIn: false,
			})
			.where(eq(wgMembers.id, membership.id));
		const newAdminId = membership.role === 'admin' ? successor.id : null;
		if (newAdminId) {
			await tx.update(wgMembers).set({ role: 'admin' }).where(eq(wgMembers.id, newAdminId));
		}
		left.push({
			wgId: membership.wgId,
			memberId: membership.id,
			name: membership.name,
			newAdminId,
		});
	}
	return { left, deletedWgIds };
}
