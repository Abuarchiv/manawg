import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { lockAccount } from './account-deletion';
import { ensureWgAdmin } from './admin-succession';
import { deleteWgCascade } from './delete-wg';
import { releaseMemberChores } from './member-departure';
import {
	accountDeletions,
	auditEvents,
	calendarSubscriptions,
	memberAbsences,
	pushSubscriptions,
	wgMembers,
	wgs,
} from './schema';
import { type DbTransaction, lockExpensePayments } from './transaction';

export type LeftWg = {
	wgId: string;
	memberId: string;
	name: string;
	newAdminId: string | null;
	newAdminName: string | null;
};

/**
 * Detaches an auth user from every WG before the account is deleted. The
 * member moves out like an "Auszug": history and balances stay with the WG,
 * the login link, push subscriptions and all absences are removed, and the WG
 * keeps an admin who can sign in: the role passes to the longest-standing
 * active flatmate with an account. A WG with no such member is deleted entirely.
 */
export async function removeAccountFromWgs(
	tx: DbTransaction,
	authUserId: string,
): Promise<{ left: LeftWg[]; deletedWgIds: string[] }> {
	await lockAccount(tx, authUserId);
	const [existingDeletion] = await tx
		.select({ authUserId: accountDeletions.authUserId })
		.from(accountDeletions)
		.where(eq(accountDeletions.authUserId, authUserId))
		.limit(1);
	if (existingDeletion) return { left: [], deletedWgIds: [] };
	await tx.insert(accountDeletions).values({ authUserId });

	const membershipWgs = await tx
		.select({ wgId: wgMembers.wgId })
		.from(wgMembers)
		.where(eq(wgMembers.authUserId, authUserId))
		.orderBy(asc(wgMembers.wgId));
	const wgIds = [...new Set(membershipWgs.map(({ wgId }) => wgId))];
	for (const wgId of wgIds) await lockExpensePayments(tx, wgId);
	if (wgIds.length > 0) {
		await tx
			.select({ id: wgs.id })
			.from(wgs)
			.where(inArray(wgs.id, wgIds))
			.orderBy(asc(wgs.id))
			.for('update');
	}

	const memberships = await tx
		.select({ id: wgMembers.id, wgId: wgMembers.wgId, name: wgMembers.name, role: wgMembers.role })
		.from(wgMembers)
		.where(eq(wgMembers.authUserId, authUserId))
		.orderBy(asc(wgMembers.wgId), asc(wgMembers.id))
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
					// Decides between keeping and deleting the WG; an unlinked row could never act as admin.
					isNotNull(wgMembers.authUserId),
				),
			)
			.orderBy(asc(wgMembers.createdAt), asc(wgMembers.id))
			.limit(1);
		if (!successor) {
			await deleteWgCascade(tx, membership.wgId);
			deletedWgIds.push(membership.wgId);
			continue;
		}
		await tx.delete(calendarSubscriptions).where(eq(calendarSubscriptions.memberId, membership.id));
		await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.memberId, membership.id));
		await tx
			.update(wgMembers)
			.set({
				authUserId: null,
				role: 'member',
				deactivatedAt: sql`coalesce(${wgMembers.deactivatedAt}, now())`,
				pushOptIn: false,
			})
			.where(eq(wgMembers.id, membership.id));
		await releaseMemberChores(tx, membership.wgId, membership.id);
		// Absence reasons are free text and can be health related, so none outlive the account:
		// neither the rows nor the reason copied into their audit events.
		await tx
			.update(auditEvents)
			.set({ metadataJson: sql`(${auditEvents.metadataJson}::jsonb - 'reason')::text` })
			.where(
				and(
					eq(auditEvents.wgId, membership.wgId),
					eq(auditEvents.eventType, 'absence.created'),
					isNotNull(auditEvents.metadataJson),
					inArray(
						auditEvents.entityId,
						tx
							.select({ id: sql<string>`${memberAbsences.id}::text` })
							.from(memberAbsences)
							.where(
								and(
									eq(memberAbsences.wgId, membership.wgId),
									eq(memberAbsences.memberId, membership.id),
								),
							),
					),
				),
			);
		await tx
			.delete(memberAbsences)
			.where(
				and(eq(memberAbsences.wgId, membership.wgId), eq(memberAbsences.memberId, membership.id)),
			);
		// Runs after the unlink, so the leaving member is never the successor.
		const newAdmin = await ensureWgAdmin(tx, membership.wgId);
		left.push({
			wgId: membership.wgId,
			memberId: membership.id,
			name: membership.name,
			newAdminId: newAdmin?.id ?? null,
			newAdminName: newAdmin?.name ?? null,
		});
	}
	return { left, deletedWgIds };
}
