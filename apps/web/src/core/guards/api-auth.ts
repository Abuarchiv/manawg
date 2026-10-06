import { getAuthenticatedUser } from '@/core/auth/server';
import { db, wgMembers } from '@/core/db';
import { HTTP, apiError } from '@/core/http/api-errors';
import { logApiError } from '@/core/infra/observability';
import { EXPECTED_MEMBER_ID_HEADER } from '@/shared/lib/member-header';
import { and, eq } from 'drizzle-orm';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * Strict UUID v4 shape check: version nibble `4` plus the RFC 4122 variant
 * bits `8|9|a|b`. Every id this app validates is generated as v4
 * (`gen_random_uuid()`, `crypto.randomUUID()`, Supabase auth ids), so
 * requiring the version keeps predictable v1 ids — timestamp and node derived
 * — out of path params and body-supplied member ids, where a guessable id
 * would address another member's row. Garbage is still rejected before the
 * database.
 */
export const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** The caller's active membership, resolved from their server-verified Supabase user. */
export interface AuthenticatedMember {
	memberId: string;
	name: string;
}

export type MemberFailureReason =
	| 'auth_required'
	| 'not_a_member'
	| 'member_deactivated'
	| 'member_context_changed'
	| 'db_error';

interface MemberOk {
	ok: true;
	member: AuthenticatedMember;
}

interface MemberFail {
	ok: false;
	reason: MemberFailureReason;
	response: NextResponse;
}

type RequireMemberResult = MemberOk | MemberFail;
export type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>;

function fail(reason: MemberFailureReason, status: number): MemberFail {
	return { ok: false, reason, response: apiError(reason, status, reason) };
}

/**
 * Resolve the caller's active membership from their server-verified Supabase
 * identity. That user-to-membership lookup is the only identity proof: the
 * session cookie cannot be forged, and cross-site writes are refused by the
 * middleware's same-origin check before a handler runs.
 *
 * `x-manawg-expected-member-id` is not a proof. It names the member a tab was
 * rendered for, so a stale tab cannot act as a different member after the
 * browser switched accounts (409 `member_context_changed`).
 */
export async function requireMember(
	req: NextRequest,
	wgId: string,
	authenticatedUser?: AuthenticatedUser,
): Promise<RequireMemberResult> {
	try {
		const user = authenticatedUser ?? (await getAuthenticatedUser(req));
		if (!user) return fail('auth_required', HTTP.UNAUTHORIZED);
		const row = await db.query.wgMembers.findFirst({
			where: and(eq(wgMembers.wgId, wgId), eq(wgMembers.authUserId, user.id)),
			columns: { id: true, name: true, deactivatedAt: true },
		});
		if (!row) return fail('not_a_member', HTTP.UNAUTHORIZED);
		// Moved-out members lose API access even while their account stays linked to the row.
		if (row.deactivatedAt) return fail('member_deactivated', HTTP.UNAUTHORIZED);
		const expectedMemberId = req.headers.get(EXPECTED_MEMBER_ID_HEADER);
		if (expectedMemberId !== null && expectedMemberId !== row.id) {
			return fail('member_context_changed', HTTP.CONFLICT);
		}
		return { ok: true, member: { memberId: row.id, name: row.name } };
	} catch (err) {
		logApiError('[requireMember] db error', err);
		return {
			ok: false,
			reason: 'db_error',
			response: apiError('db_error', HTTP.SERVICE_UNAVAILABLE),
		};
	}
}
