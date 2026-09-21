import { createHmac, timingSafeEqual } from 'node:crypto';

const MEMBER_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * Deterministic per-member session token.
 *
 * `token = HMAC-SHA256(MEMBER_SESSION_SECRET, "${wgId}:${memberId}")`
 *
 * Because the token is a pure function of (secret, wgId, memberId), the
 * server never has to store or look up a session — it can always recompute
 * the expected token for a given pair. That means:
 *   - no migration/backfill for existing `wg_members` rows,
 *   - no session table, no expiry bookkeeping,
 *   - a member is "verified" the moment they present a token that matches,
 *     and "legacy" (memberId matched but token missing/invalid) otherwise.
 *
 * This closes the spoofing hole where `x-manawg-member-id` alone — a bare
 * UUID an attacker can read off `GET /api/wg/[code]/members` — was treated
 * as proof of identity. `MEMBER_SESSION_SECRET` never leaves the server, so
 * an attacker who only knows a member's id cannot forge their token.
 */

function getSecret(): string | null {
	const raw = process.env.MEMBER_SESSION_SECRET;
	return raw && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Derive the token for a member. Returns `null` when `MEMBER_SESSION_SECRET`
 * is unset — callers must treat that as "no token available" (never fall
 * back to an unsigned value).
 */
export function deriveMemberToken(wgId: string, memberId: string): string | null {
	const secret = getSecret();
	if (!secret) return null;
	return createHmac('sha256', secret).update(`${wgId}:${memberId}`).digest('hex');
}

/**
 * Constant-time verification of a client-supplied token against the
 * expected value for (wgId, memberId). Fails closed: a missing token, a
 * missing/unset secret, a length mismatch, or an invalid hex token all
 * verify as `false` rather than throwing or short-circuiting into a timing
 * side-channel.
 */
export function verifyMemberToken(
	wgId: string,
	memberId: string,
	token: string | null | undefined,
): boolean {
	if (!token) return false;
	if (!MEMBER_TOKEN_PATTERN.test(token)) return false;
	const expected = deriveMemberToken(wgId, memberId);
	if (!expected) return false;

	const expectedBuf = Buffer.from(expected, 'hex');
	const providedBuf = Buffer.from(token, 'hex');
	if (expectedBuf.length !== providedBuf.length) return false;
	return timingSafeEqual(expectedBuf, providedBuf);
}
