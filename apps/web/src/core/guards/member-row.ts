import { HTTP, apiError } from '@/core/http/api-errors';
import { EXPECTED_MEMBER_ID_HEADER } from '@/shared/lib/member-header';
import type { NextResponse } from 'next/server';

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

export interface MemberOk {
	ok: true;
	member: AuthenticatedMember;
}

export interface MemberFail {
	ok: false;
	reason: MemberFailureReason;
	response: NextResponse;
}

export type RequireMemberResult = MemberOk | MemberFail;

export function memberFailure(reason: MemberFailureReason, status: number): MemberFail {
	return { ok: false, reason, response: apiError(reason, status, reason) };
}

/**
 * The member rules shared by every guard: a missing row is not a member, a moved-out member
 * loses API access, and `x-manawg-expected-member-id` only names the member a tab was rendered
 * for (409 when the browser switched accounts since), never a proof of identity.
 */
export function memberFromRow(
	req: { headers: Headers },
	row: { id: string; name: string; deactivatedAt: Date | null } | null | undefined,
): RequireMemberResult {
	if (!row) return memberFailure('not_a_member', HTTP.UNAUTHORIZED);
	if (row.deactivatedAt) return memberFailure('member_deactivated', HTTP.UNAUTHORIZED);
	const expectedMemberId = req.headers.get(EXPECTED_MEMBER_ID_HEADER);
	if (expectedMemberId !== null && expectedMemberId !== row.id) {
		return memberFailure('member_context_changed', HTTP.CONFLICT);
	}
	return { ok: true, member: { memberId: row.id, name: row.name } };
}
