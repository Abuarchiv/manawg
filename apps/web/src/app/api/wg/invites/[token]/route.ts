import { getAuthenticatedUser } from '@/core/auth/server';
import { db, wgInvites, wgMembers, wgs } from '@/core/db';
import { inviteStatus } from '@/core/db/wg-invites';
import { shareCodeMissResponse } from '@/core/guards/share-code-miss';
import {
	HTTP,
	apiError,
	notFound,
	serverError,
	serviceUnavailable,
	unauthorized,
} from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';
import { isInviteToken } from '@/core/utils/invite-token';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Preview of an invitation for a signed-in account, so the join page can name the WG before the
 * visitor types a name. Unknown tokens count against the account's miss budget; the token itself
 * is the only secret, the WG is never looked up by its share code here.
 */
export async function GET(req: NextRequest, ctx: RouteCtx<{ token: string }>) {
	const { token } = await ctx.params;
	let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
	try {
		user = await getAuthenticatedUser(req);
	} catch (err) {
		logApiError('[api/wg/invites GET] auth error', err);
		return serviceUnavailable('db_error');
	}
	if (!user) return unauthorized('auth_required', 'auth_required');
	const invalid = () =>
		shareCodeMissResponse(user.id, notFound('invite_invalid', 'invite_invalid'));
	if (!isInviteToken(token)) return invalid();
	try {
		const [row] = await db
			.select({
				wgId: wgs.id,
				name: wgs.name,
				shareCode: wgs.shareCode,
				expiresAt: wgInvites.expiresAt,
				revokedAt: wgInvites.revokedAt,
				useCount: wgInvites.useCount,
				maxUses: wgInvites.maxUses,
			})
			.from(wgInvites)
			.innerJoin(wgs, eq(wgs.id, wgInvites.wgId))
			.where(eq(wgInvites.token, token))
			.limit(1);
		if (!row) return await invalid();
		const [membership] = await db
			.select({ id: wgMembers.id, deactivatedAt: wgMembers.deactivatedAt })
			.from(wgMembers)
			.where(and(eq(wgMembers.wgId, row.wgId), eq(wgMembers.authUserId, user.id)))
			.limit(1);
		if (membership && !membership.deactivatedAt) {
			return NextResponse.json(
				{ error: 'already_member', code: 'already_member', shareCode: row.shareCode },
				{ status: HTTP.CONFLICT },
			);
		}
		if (inviteStatus(row) !== 'valid')
			return apiError('invite_expired', HTTP.GONE, 'invite_expired');
		// Members created before accounts existed; they can take their profile over after joining in.
		const unclaimed = await db
			.select({ id: wgMembers.id, name: wgMembers.name })
			.from(wgMembers)
			.where(
				and(
					eq(wgMembers.wgId, row.wgId),
					isNull(wgMembers.authUserId),
					isNull(wgMembers.deactivatedAt),
				),
			)
			.orderBy(asc(wgMembers.name))
			.limit(50);
		return NextResponse.json({
			wg: { name: row.name, shareCode: row.shareCode },
			unclaimed,
			expiresAt: row.expiresAt,
		});
	} catch (err) {
		logApiError('[api/wg/invites GET] failed', err);
		return serverError('db_error');
	}
}
