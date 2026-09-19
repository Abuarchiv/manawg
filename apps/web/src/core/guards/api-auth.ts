import { getAuthenticatedUser } from '@/core/auth/server';
import { db, wgMembers } from '@/core/db';
import { apiError } from '@/core/errors';
import { verifyMemberToken } from '@/core/guards/member-token';
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

function unauthorized(code: string): NextResponse {
	return apiError(code, HTTP_UNAUTHORIZED, code);
}

/**
 * Resolve the caller's active membership from their server-verified Supabase
 * identity. The `x-manawg-member-token` HMAC header is verified against the
 * expected value for (wgId, memberId). A missing or invalid token yields
 * `verified: false` — callers that require verified identity (admin gates,
 * money-mutating routes) must check `member.verified` and reject otherwise.
 */
export async function requireMember(req: NextRequest, wgId: string): Promise<RequireMemberResult> {
	try {
		const user = await getAuthenticatedUser(req);
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
		const token = req.headers.get('x-manawg-member-token');
		const verified = verifyMemberToken(wgId, row.id, token);
		return { ok: true, member: { memberId: row.id, name: row.name, verified } };
	} catch (err) {
		console.error('[requireMember] db error', err);
		return { ok: false, response: apiError('db_error', HTTP_SERVICE_UNAVAILABLE) };
	}
}
