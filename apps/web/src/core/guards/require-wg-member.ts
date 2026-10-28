import type { NextRequest, NextResponse } from 'next/server';
import { type AuthenticatedMember, memberFromRow } from '@/core/guards/member-row';
import { requireAccount } from '@/core/guards/require-account';
import { type ResolvedWg, resolveWg } from '@/core/guards/resolve';
import { shareCodeMissResponse } from '@/core/guards/share-code-miss';
import { notFound } from '@/core/http/api-errors';

interface WgMembershipOk<W> {
	ok: true;
	wg: W;
	member: AuthenticatedMember;
	authUserId: string;
}

interface WgMembershipFail {
	ok: false;
	response: NextResponse;
}

export type WgMembershipResult<W> = WgMembershipOk<W> | WgMembershipFail;

/**
 * The steps every WG-scoped guard shares: authenticate the Supabase user, then
 * load the WG by share code and the caller's membership in one query.
 *
 * Only authenticated users reach the WG lookup, so an anonymous caller cannot
 * learn whether a share code exists. An unknown code and a WG the caller does
 * not belong to both count against the share-code miss budget.
 *
 * Database errors are thrown, so callers keep their try/catch → `serverError`
 * handling.
 */
export async function requireWgMembership(
	req: NextRequest,
	code: string,
	/** Prefix for the auth-outage log, e.g. `requireWgMember`. */
	label: string,
): Promise<WgMembershipResult<ResolvedWg>> {
	const account = await requireAccount(req, label);
	if (!account.ok) return { ok: false, response: account.response };
	const user = account.user;

	const resolved = await resolveWg(code, user.id);
	if (!resolved) {
		return { ok: false, response: await shareCodeMissResponse(user.id, notFound('wg_not_found')) };
	}
	const { member: memberRow, ...wg } = resolved;
	const auth = memberFromRow(req, memberRow);
	if (!auth.ok) {
		const response =
			auth.reason === 'not_a_member'
				? await shareCodeMissResponse(user.id, auth.response)
				: auth.response;
		return { ok: false, response };
	}
	return { ok: true, wg, member: auth.member, authUserId: user.id };
}

/**
 * Resolve a share code to its WG and verify the caller is a member — the
 * standard guard for every `/api/wg/[code]/...` route handler.
 *
 * Expects `code` to already be normalized and validated via
 * {@link normalizeShareCode} / {@link isValidShareCode}; routes keep that
 * cheap check before parsing the body so error precedence stays stable.
 *
 * Returns either:
 *   - `{ ok: true, wg, member }` — the WG row plus the caller's membership
 *   - `{ ok: false, response }` — a 404 (`wg_not_found`) or the failure from
 *     {@link requireMember}, ready to be returned as-is
 */
export function requireWgMember(
	req: NextRequest,
	code: string,
): Promise<WgMembershipResult<ResolvedWg>> {
	return requireWgMembership(req, code, 'requireWgMember');
}
