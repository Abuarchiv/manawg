import { recordAuditEvent } from '@/core/audit';
import { wgMembers } from '@/core/db';
import { lockActiveAccountMember } from '@/core/db/account-deletion';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgAdmin } from '@/core/guards/require-wg-admin';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, conflict, forbidden, notFound, payloadTooLarge } from '@/core/http/api-errors';
import { readJsonBody } from '@/core/http/read-json';
import { withExpensePaymentLock } from '@/features/expenses/expense-payments';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * POST hands the single admin role to another active member of the same WG.
 * Same lock order as account deletion (WG row, then member rows); the old admin
 * is demoted before the target is promoted so the one-admin-per-WG unique index
 * is never violated. No schema change: it only flips `wg_members.role`.
 */
export const POST = withWgRoute<{ id: string }>(
	'members/[id]/admin POST',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const raw = await readJsonBody(req, 1024);
		if (!raw.ok) {
			return raw.reason === 'payload_too_large' ? payloadTooLarge() : badRequest('invalid_json');
		}
		const admin = await requireWgAdmin(req, code, 'member-admin-transfer');
		if (!admin.ok) return admin.response;
		const { wg, member } = admin;
		if (id === member.memberId) return badRequest('already_admin');

		const result = await withExpensePaymentLock(wg.id, async (tx) => {
			const actor = await lockActiveAccountMember(tx, wg.id, member.memberId, admin.authUserId);
			if (!actor || actor.role !== 'admin' || !member.verified) {
				return { ok: false as const, response: forbidden('not_admin', 'not_admin') };
			}
			const [target] = await tx
				.select({
					id: wgMembers.id,
					name: wgMembers.name,
					deactivatedAt: wgMembers.deactivatedAt,
					authUserId: wgMembers.authUserId,
				})
				.from(wgMembers)
				.where(and(eq(wgMembers.id, id), eq(wgMembers.wgId, wg.id)))
				.for('update');
			if (!target) return { ok: false as const, response: notFound('member_not_found') };
			if (target.deactivatedAt)
				return { ok: false as const, response: conflict('member_inactive') };
			// An admin without a login could never use the role; the WG would be left without one.
			if (!target.authUserId)
				return { ok: false as const, response: conflict('member_not_linked') };
			await tx.update(wgMembers).set({ role: 'member' }).where(eq(wgMembers.id, actor.id));
			await tx.update(wgMembers).set({ role: 'admin' }).where(eq(wgMembers.id, target.id));
			return { ok: true as const, target };
		});
		if (!result.ok) return result.response;

		await recordAuditEvent({
			wgId: wg.id,
			memberId: member.memberId,
			eventType: 'member.admin_transferred',
			entityType: 'member',
			entityId: result.target.id,
			summary: `${member.name} hat die Admin-Rolle an ${result.target.name} übergeben.`,
			metadata: { name: result.target.name },
		});
		return NextResponse.json({ member: { id: result.target.id, name: result.target.name } });
	},
);
