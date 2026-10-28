import { recordAuditEvent } from '@/core/audit';
import { db, wgInvites, wgMembers } from '@/core/db';
import { activeInvitesOf, createWgInvite } from '@/core/db/wg-invites';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { conflict, rateLimitResponse } from '@/core/http/api-errors';
import { requestOrigin } from '@/core/http/request-origin';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { invitePath } from '@/core/utils/invite-token';
import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/** Active invitations of the WG, newest first. The token itself is never listed. */
export const GET = withWgRoute('invites GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const rows = await db
		.select({
			id: wgInvites.id,
			createdAt: wgInvites.createdAt,
			expiresAt: wgInvites.expiresAt,
			maxUses: wgInvites.maxUses,
			useCount: wgInvites.useCount,
			createdByName: wgMembers.name,
		})
		.from(wgInvites)
		.leftJoin(wgMembers, eq(wgMembers.id, wgInvites.createdByMemberId))
		.where(activeInvitesOf(auth.wg.id))
		.orderBy(desc(wgInvites.createdAt));
	return NextResponse.json({ invites: rows });
});

/** A member creates an invitation link that works for 7 days. */
export const POST = withWgRoute('invites POST', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const rate = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `invite-create:${wgId}:${auth.member.memberId}`),
		'rate_limited',
		'rate_limited',
	);
	if (rate) return rate;

	const invite = await createWgInvite(wgId, auth.member.memberId);
	if (!invite) return conflict('invite_limit_reached', 'invite_limit_reached');
	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'wg.invite_created',
		entityType: 'wg',
		entityId: wgId,
		summary: `${auth.member.name} hat eine Einladung erstellt.`,
		metadata: { inviteId: invite.id },
	});
	return NextResponse.json({
		id: invite.id,
		url: `${requestOrigin(req)}${invitePath(invite.token)}`,
		expiresAt: invite.expiresAt,
	});
});
