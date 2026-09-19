import { apiError, notFound } from '@/core/errors';
import { type VerifiedMember, requireMember } from '@/core/guards/api-auth';
import { type ResolvedWg, resolveWg } from '@/core/guards/resolve';
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

const HTTP_UNAUTHORIZED = 401;
const SUPABASE_AUTH_TOKEN_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?$/;

function hasSupabaseAuthAttempt(req: NextRequest): boolean {
	return (
		req.headers.has('authorization') ||
		req.cookies.getAll().some(({ name }) => SUPABASE_AUTH_TOKEN_COOKIE.test(name))
	);
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
 *   - `{ ok: true, wg, member }` — full WG row plus the verified caller
 *   - `{ ok: false, response }` — a 404 (`wg_not_found`) or the 401 from
 *     {@link requireMember}, ready to be returned as-is
 *
 * Requests without any Supabase auth attempt return 401 before the WG lookup.
 * Authenticated requests continue through {@link requireMember} once, which
 * preserves server-side Supabase membership verification.
 *
 * Database errors from the WG lookup are thrown, so callers keep their
 * existing try/catch → `serverError` handling.
 */
export async function requireWgMember(
	req: NextRequest,
	code: string,
): Promise<RequireWgMemberResult> {
	if (!hasSupabaseAuthAttempt(req)) {
		return {
			ok: false,
			response: apiError('auth_required', HTTP_UNAUTHORIZED, 'auth_required'),
		};
	}

	const wg = await resolveWg(code);
	if (!wg) return { ok: false, response: notFound('wg_not_found') };
	const auth = await requireMember(req, wg.id);
	if (!auth.ok) return { ok: false, response: auth.response };
	return { ok: true, wg, member: auth.member };
}
