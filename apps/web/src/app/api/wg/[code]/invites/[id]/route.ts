import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { recordAuditEvent } from '@/core/audit';
import { db, wgInvites } from '@/core/db';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, notFound, rateLimitResponse } from '@/core/http/api-errors';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';

/** Any member may revoke an invitation of their WG; a revoked link stops working at once. */
export const DELETE = withWgRoute<{ id: string }>('invites DELETE', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const rate = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `invite-revoke:${wgId}:${auth.member.memberId}`),
		'rate_limited',
		'rate_limited',
	);
	if (rate) return rate;

	const revoked = await db
		.update(wgInvites)
		.set({ revokedAt: new Date() })
		.where(and(eq(wgInvites.id, id), eq(wgInvites.wgId, wgId), isNull(wgInvites.revokedAt)))
		.returning({ id: wgInvites.id });
	if (revoked.length === 0) return notFound('invite_not_found');
	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'wg.invite_revoked',
		entityType: 'wg',
		entityId: wgId,
		summary: `${auth.member.name} hat eine Einladung widerrufen.`,
		metadata: { inviteId: id },
	});
	return NextResponse.json({ revoked: true });
});
