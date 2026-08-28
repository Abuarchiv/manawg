import { type VerifiedMember, requireMember } from '@/lib/api-auth';
import { notFound } from '@/lib/api-error';
import { type ResolvedWg, resolveWg } from '@/lib/wg/resolve';
import type { NextRequest, NextResponse } from 'next/server';

interface WgMemberOk {
	ok: true;
	wg: ResolvedWg;
	member: VerifiedMember;
}

interface WgMemberFail {
	ok: false;
	response: NextResponse;
}

type RequireWgMemberResult = WgMemberOk | WgMemberFail;

/**
 * Resolve a share code to its WG and verify the caller is a member — the
 * standard guard for every `/api/wg/[code]/...` route handler.
 *
 * Expects `code` to already be normalized and validated via
 * {@link normalizeShareCode} / {@link isValidShareCode}; routes keep that
 * cheap check before parsing the body so error precedence stays stable.
 *
 * Returns either:
 *   - `{ ok: true, wg, member }` — full WG row plus the verified caller
 *   - `{ ok: false, response }` — a 404 (`wg_not_found`) or the 401 from
 *     {@link requireMember}, ready to be returned as-is
 *
 * Database errors from the WG lookup are thrown, so callers keep their
 * existing try/catch → `serverError` handling.
 */
export async function requireWgMember(
	req: NextRequest,
	code: string,
): Promise<RequireWgMemberResult> {
	const wg = await resolveWg(code);
	if (!wg) return { ok: false, response: notFound('wg_not_found') };
	const auth = await requireMember(req, wg.id);
	if (!auth.ok) return { ok: false, response: auth.response };
	return { ok: true, wg, member: auth.member };
}
