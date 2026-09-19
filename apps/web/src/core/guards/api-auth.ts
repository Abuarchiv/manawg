import { getAuthenticatedUser } from '@/core/auth/server';
import { db, wgMembers } from '@/core/db';
import { apiError } from '@/core/errors';
import { and, eq } from 'drizzle-orm';
import type { NextRequest, NextResponse } from 'next/server';

const HTTP_SERVICE_UNAVAILABLE = 503;

const HTTP_UNAUTHORIZED = 401;

/**
 * Loose UUID v4-ish shape check. We do not enforce the version nibble strictly
 * because Postgres `uuid` accepts any well-formed UUID. We only want to reject
 * obvious garbage before hitting the database.
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID_PATTERN.test(value);
}

export interface VerifiedMember {
	memberId: string;
	name: string;
	/** True because this member was resolved from a verified Supabase user. */
	verified: boolean;
}

interface MemberOk {
	ok: true;
	member: VerifiedMember;
}

interface MemberFail {
	ok: false;
	response: NextResponse;
}

type RequireMemberResult = MemberOk | MemberFail;
type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>;

function unauthorized(code: string): NextResponse {
	return apiError(code, HTTP_UNAUTHORIZED, code);
}

/**
 * Resolve the caller's active membership from their server-verified Supabase
 * identity. The server-side Supabase user-to-membership lookup is the
 * authoritative identity proof. HMAC member tokens remain limited to the
 * explicit legacy-claim flow and are not required for normal authenticated
 * app requests.
 */
export async function requireMember(
	req: NextRequest,
	wgId: string,
	authenticatedUser?: AuthenticatedUser,
): Promise<RequireMemberResult> {
	try {
		const user = authenticatedUser ?? (await getAuthenticatedUser(req));
		if (!user) return { ok: false, response: unauthorized('auth_required') };
		const row = await db.query.wgMembers.findFirst({
			where: and(eq(wgMembers.wgId, wgId), eq(wgMembers.authUserId, user.id)),
			columns: { id: true, name: true, deactivatedAt: true },
		});
		if (!row) {
			return { ok: false, response: unauthorized('not_a_member') };
		}
		// Moved-out members lose API access even if their localStorage still
		// holds a valid member id.
		if (row.deactivatedAt) {
			return { ok: false, response: unauthorized('member_deactivated') };
		}
		return { ok: true, member: { memberId: row.id, name: row.name, verified: true } };
	} catch (err) {
		console.error('[requireMember] db error', err);
		return { ok: false, response: apiError('db_error', HTTP_SERVICE_UNAVAILABLE) };
	}
}
