import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/core/auth/server';
import { db, wgMembers } from '@/core/db';
import { memberFailure, memberFromRow, type RequireMemberResult } from '@/core/guards/member-row';
import { apiError, HTTP } from '@/core/http/api-errors';
import { logApiError } from '@/core/infra/observability';

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

export type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>;

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
		if (!user) return memberFailure('auth_required', HTTP.UNAUTHORIZED);
		const row = await db.query.wgMembers.findFirst({
			where: and(eq(wgMembers.wgId, wgId), eq(wgMembers.authUserId, user.id)),
			columns: { id: true, name: true, deactivatedAt: true },
		});
		return memberFromRow(req, row);
	} catch (err) {
		logApiError('[requireMember] db error', err);
		return {
			ok: false,
			reason: 'db_error',
			response: apiError('db_error', HTTP.SERVICE_UNAVAILABLE),
		};
	}
}
