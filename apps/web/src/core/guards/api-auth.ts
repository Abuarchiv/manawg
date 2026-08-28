import { db, wgMembers } from '@/core/db';
import { apiError } from '@/core/errors';
import { verifyMemberToken } from '@/core/guards/member-token';
import { MEMBER_ID_HEADER, MEMBER_TOKEN_HEADER } from '@manawg/shared/lib/member-header';
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
	/**
	 * `true` when the request carried a valid `x-manawg-member-token` HMAC
	 * for this (wgId, memberId) pair. `false` means "legacy" auth — the
	 * memberId header matched a real row, but there was no (or an invalid)
	 * token. Non-destructive routes may accept legacy requests; admin-gated
	 * mutations must require `verified === true` (see `checkWgAdminAccess`).
	 */
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
 * Verify the caller is a member of the given WG.
 *
 * The client must send `x-manawg-member-id: <uuid>` on every mutating request.
 * The header value is checked against the `wg_members` table scoped to `wgId`.
 *
 * Returns either:
 *   - `{ ok: true, member }` when the header is present and matches a row
 *   - `{ ok: false, response }` carrying a 401 NextResponse the caller must return
 */
export async function requireMember(req: NextRequest, wgId: string): Promise<RequireMemberResult> {
	const headerValue = req.headers.get(MEMBER_ID_HEADER);
	const memberId =
		typeof headerValue === 'string' && headerValue.trim().length > 0 ? headerValue.trim() : null;

	if (!memberId) {
		return { ok: false, response: unauthorized('member_id_required') };
	}
	if (!UUID_PATTERN.test(memberId)) {
		return { ok: false, response: unauthorized('member_id_invalid') };
	}

	try {
		const row = await db.query.wgMembers.findFirst({
			where: and(eq(wgMembers.id, memberId), eq(wgMembers.wgId, wgId)),
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
		const tokenHeader = req.headers.get(MEMBER_TOKEN_HEADER);
		const verified = verifyMemberToken(wgId, row.id, tokenHeader);
		return { ok: true, member: { memberId: row.id, name: row.name, verified } };
	} catch (err) {
		console.error('[requireMember] db error', err);
		return { ok: false, response: apiError('db_error', HTTP_SERVICE_UNAVAILABLE) };
	}
}
