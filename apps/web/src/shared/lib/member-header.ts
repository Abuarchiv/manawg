/**
 * Header names shared by API routes and client code. Lives in a server-safe
 * module (no `'use client'`) so both sides can import it without triggering
 * Next.js's client/server boundary wrapping.
 */

/**
 * The member a tab was rendered for. Not an identity proof: the server
 * compares it with the membership of the cookie-authenticated user and answers
 * 409 `member_context_changed` on a mismatch, so a stale tab cannot act as a
 * different member. The E2E fixture mode, which has no Supabase session, reads
 * it as the caller.
 */
export const EXPECTED_MEMBER_ID_HEADER = 'x-manawg-expected-member-id';

/** Member-context header for plain `fetch` calls outside `apiFetch` (downloads, WG delete). */
export function memberContextHeader(memberId: string): Record<string, string> {
	return { [EXPECTED_MEMBER_ID_HEADER]: memberId };
}

/**
 * Legacy-profile recovery only (`POST /api/wg/[code]/members/[id]/claim`):
 * the stored member id and its HMAC token from before account login. See
 * `@/core/guards/legacy-claim-proof`.
 */
export const LEGACY_CLAIM_MEMBER_ID_HEADER = 'x-manawg-member-id';
export const LEGACY_CLAIM_TOKEN_HEADER = 'x-manawg-member-token';
