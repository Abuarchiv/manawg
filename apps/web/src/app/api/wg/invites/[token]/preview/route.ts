import { type NextRequest, NextResponse } from 'next/server';
import { findInvitePreview } from '@/core/db/invite-preview';
import { noStore, notFound, rateLimitResponse, serverError } from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, clientIpKey, invitePreviewLimiter } from '@/core/rate-limit';

/**
 * Preview of an invitation for a visitor who is not signed in yet: the WG name, who invited and
 * how many members are active, so the sign-up page can say "Mika invites you to Lindenstrasse" and
 * "3 flatmates already in". The token is the only secret and is never found by guessing
 * (128 bits), so this reveals nothing the link does not. Every token that cannot be used
 * (malformed, unknown, expired, revoked, used up) gets the same bare 404, so the answer cannot
 * tell those cases apart. No names, ids or share code of members leave here, only their number.
 */
export async function GET(req: NextRequest, ctx: RouteCtx<{ token: string }>) {
	const limited = rateLimitResponse(
		await checkRateLimit(invitePreviewLimiter, clientIpKey(req)),
		'rate_limited',
		'rate_limited',
	);
	if (limited) return noStore(limited);

	const { token } = await ctx.params;
	try {
		const preview = await findInvitePreview(token);
		if (!preview) return noStore(notFound('invite_unavailable', 'invite_unavailable'));
		return noStore(NextResponse.json(preview));
	} catch (err) {
		logApiError('[api/wg/invites preview GET] failed', err);
		return noStore(serverError('db_error'));
	}
}
