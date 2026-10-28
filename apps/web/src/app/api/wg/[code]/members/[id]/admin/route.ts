import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { recordAuditEvent } from '@/core/audit';
import { wgMembers } from '@/core/db';
import { lockActiveAccountMember } from '@/core/db/account-deletion';
import { rejectWrite, responseCodec, withIdempotentWrite } from '@/core/db/idempotent-write';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	payloadTooLarge,
	rateLimitResponse,
} from '@/core/http/api-errors';
import { readJsonBody } from '@/core/http/read-json';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { withExpensePaymentLock } from '@/features/expenses/server/expense-payments';

const transferCodec = responseCodec();

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
		// Membership only: the admin check runs inside the write, so a retry of an applied transfer
		// (the caller is a plain member by then) is replayed instead of answering 403.
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const { wg, member } = auth;
		if (id === member.memberId) return badRequest('already_admin');

		const result = await withIdempotentWrite(
			{
				scope: `admin-transfer:${wg.id}:${member.memberId}:${id}`,
				key: readIdempotencyKey(req),
				codec: transferCodec,
				inTransaction: (work) => withExpensePaymentLock(wg.id, work),
				prepare: async () => {
					const limited = rateLimitResponse(
						await checkRateLimit(
							wgWriteLimiter,
							`member-admin-transfer:${wg.id}:${member.memberId}`,
						),
					);
					return limited ? { stop: limited } : { input: undefined };
				},
			},
			async (tx) => {
				const actor = await lockActiveAccountMember(tx, wg.id, member.memberId, auth.authUserId);
				if (!actor || actor.role !== 'admin')
					return rejectWrite(forbidden('not_admin', 'not_admin'));
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
				if (!target) return rejectWrite(notFound('member_not_found'));
				if (target.deactivatedAt) return rejectWrite(conflict('member_inactive'));
				// An admin without a login could never use the role; the WG would be left without one.
				if (!target.authUserId) return rejectWrite(conflict('member_not_linked'));
				await tx.update(wgMembers).set({ role: 'member' }).where(eq(wgMembers.id, actor.id));
				await tx.update(wgMembers).set({ role: 'admin' }).where(eq(wgMembers.id, target.id));
				return {
					status: 200,
					body: { member: { id: target.id, name: target.name } },
					context: { target },
				};
			},
		);
		if (result.kind === 'stopped') return result.response;
		if (result.kind === 'replayed')
			return NextResponse.json(result.body, { status: result.status });
		const written = result.context;
		if (!written) return NextResponse.json(result.body, { status: result.status });
		if ('rejected' in written) return written.rejected;

		await recordAuditEvent({
			wgId: wg.id,
			memberId: member.memberId,
			eventType: 'member.admin_transferred',
			entityType: 'member',
			entityId: written.target.id,
			summary: `${member.name} hat die Admin-Rolle an ${written.target.name} übergeben.`,
			metadata: { name: written.target.name },
		});
		return NextResponse.json(result.body, { status: result.status });
	},
);
