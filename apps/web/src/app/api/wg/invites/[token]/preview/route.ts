import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, wgInvites, wgMembers, wgs } from '@/core/db';
import { inviteStatus } from '@/core/db/wg-invites';
import { noStore, notFound, rateLimitResponse, serverError } from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, clientIpKey, invitePreviewLimiter } from '@/core/rate-limit';
import { isInviteToken } from '@/core/utils/invite-token';

/** The first word of a display name: the invitation names a person, not the full entry. */
function firstName(name: string | null): string | null {
	return name?.trim().split(/\s+/)[0] || null;
}

/**
 * Preview of an invitation for a visitor who is not signed in yet: the WG name and who invited,
 * so the sign-up page can say "Mika invites you to Lindenstrasse". The token is the only secret
 * and is never found by guessing (128 bits), so this reveals nothing the link does not. Every
 * token that cannot be used (malformed, unknown, expired, revoked, used up) gets the same bare
 * 404, so the answer cannot tell those cases apart. No members, ids or share code leave here.
 */
export async function GET(req: NextRequest, ctx: RouteCtx<{ token: string }>) {
	const limited = rateLimitResponse(
		await checkRateLimit(invitePreviewLimiter, clientIpKey(req)),
		'rate_limited',
		'rate_limited',
	);
	if (limited) return noStore(limited);

	const { token } = await ctx.params;
	const unavailable = () => noStore(notFound('invite_unavailable', 'invite_unavailable'));
	if (!isInviteToken(token)) return unavailable();
	try {
		const [row] = await db
			.select({
				wgName: wgs.name,
				inviterName: wgMembers.name,
				inviterDeactivatedAt: wgMembers.deactivatedAt,
				expiresAt: wgInvites.expiresAt,
				revokedAt: wgInvites.revokedAt,
				useCount: wgInvites.useCount,
				maxUses: wgInvites.maxUses,
			})
			.from(wgInvites)
			.innerJoin(wgs, eq(wgs.id, wgInvites.wgId))
			.leftJoin(wgMembers, eq(wgMembers.id, wgInvites.createdByMemberId))
			.where(eq(wgInvites.token, token))
			.limit(1);
		if (!row || inviteStatus(row) !== 'valid') return unavailable();
		return noStore(
			NextResponse.json({
				wgName: row.wgName,
				inviterName: row.inviterDeactivatedAt ? null : firstName(row.inviterName),
			}),
		);
	} catch (err) {
		logApiError('[api/wg/invites preview GET] failed', err);
		return noStore(serverError('db_error'));
	}
}
