import { getAuthenticatedUser } from '@/core/auth/server';
import { db } from '@/core/db';
import { apiError, forbidden, notFound, tooMany } from '@/core/errors';
import { checkWgAdminAccess } from '@/core/guards/admin';
import { type VerifiedMember, requireMember } from '@/core/guards/api-auth';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import type { NextRequest, NextResponse } from 'next/server';

interface WgAdminOk {
	ok: true;
	wg: { id: string; name: string; joiningEnabled: boolean };
	member: VerifiedMember;
	authUserId: string;
}

type RequireWgAdminResult = WgAdminOk | { ok: false; response: NextResponse };

/**
 * The guard for WG-settings writes: resolve the share code, verify the caller
 * is a member, require that they are the verified admin, and take a
 * per-member write slot.
 *
 * PATCH and DELETE on the WG root each carried this same 20-line sequence.
 * Having it once matters more here than elsewhere: these four checks are what
 * stand between any member and renaming or deleting the whole WG, so a copy
 * that falls a step behind is a privilege-escalation bug, not a style issue.
 */
export async function requireWgAdmin(
	req: NextRequest,
	code: string,
	/** Rate-limit bucket, e.g. `wg-settings`. Scoped by WG and member. */
	scope: string,
): Promise<RequireWgAdminResult> {
	let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
	try {
		user = await getAuthenticatedUser(req);
	} catch (err) {
		logApiError('[requireWgAdmin] auth error', err);
		return { ok: false, response: apiError('db_error', 503) };
	}
	if (!user) return { ok: false, response: apiError('auth_required', 401, 'auth_required') };

	const wg = await db.query.wgs.findFirst({
		where: (w, { eq }) => eq(w.shareCode, code),
		columns: { id: true, name: true, joiningEnabled: true },
	});
	if (!wg) return { ok: false, response: notFound('wg_not_found') };

	const auth = await requireMember(req, wg.id, user);
	if (!auth.ok) return { ok: false, response: auth.response };

	const access = await checkWgAdminAccess(wg.id, auth.member.memberId, auth.member.verified);
	if (!access.allowed) {
		return {
			ok: false,
			response:
				access.reason === 'not_verified'
					? forbidden('member_not_verified', 'member_not_verified')
					: forbidden('not_admin', 'not_admin'),
		};
	}

	const rate = await checkRateLimit(wgWriteLimiter, `${scope}:${wg.id}:${auth.member.memberId}`);
	if (!rate.success) return { ok: false, response: tooMany() };

	return { ok: true, wg, member: auth.member, authUserId: user.id };
}
