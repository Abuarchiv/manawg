import { NextResponse } from 'next/server';
import { recordAuditEvent } from '@/core/audit';
import { currentSoloInvite } from '@/core/db/wg-invites';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { conflict, rateLimitResponse } from '@/core/http/api-errors';
import { requestOrigin } from '@/core/http/request-origin';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { invitePath } from '@/core/utils/invite-token';

/**
 * The link on the WG home's invite card, called when the card opens. Only a WG with exactly one
 * active member gets one (`invite: null` otherwise): its newest invitation while that still works,
 * else a fresh 14-day one. The sole member may create links anyway, so handing back the token of
 * a link that member's WG holds reveals nothing new.
 */
export const POST = withWgRoute('invites current POST', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const rate = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `invite-current:${wgId}:${auth.member.memberId}`),
		'rate_limited',
		'rate_limited',
	);
	if (rate) return rate;

	const result = await currentSoloInvite(wgId, auth.member.memberId);
	if (result.status === 'not_solo') return NextResponse.json({ invite: null });
	if (result.status === 'limit_reached') {
		return conflict('invite_limit_reached', 'invite_limit_reached');
	}
	if (result.fresh) {
		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'wg.invite_created',
			entityType: 'wg',
			entityId: wgId,
			actorName: auth.member.name,
			metadata: { inviteId: result.invite.id },
		});
	}
	return NextResponse.json(
		{
			invite: {
				id: result.invite.id,
				url: `${requestOrigin(req)}${invitePath(result.invite.token)}`,
				expiresAt: result.invite.expiresAt,
			},
		},
		{ headers: { 'Cache-Control': 'private, no-store' } },
	);
});
