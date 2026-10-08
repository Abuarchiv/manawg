import { createHmac, timingSafeEqual } from 'node:crypto';
import { acceptedSigningSecrets } from '@/core/infra/signing-secrets';

const LEGACY_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * Proof for the explicit legacy-profile recovery (`POST .../members/[id]/claim`).
 *
 * Profiles created before account login kept `HMAC-SHA256(MEMBER_SESSION_SECRET,
 * "${wgId}:${memberId}")` in the browser. Recovery links such an unlinked member
 * row to the signed-in Supabase account only when that stored token matches, so
 * knowing a member id alone (it is visible in the members list) is not enough.
 * Normal API access never uses this token; the Supabase session is the identity.
 *
 * Constant-time and fail-closed: a missing token, an unset secret, or a
 * malformed token all verify as `false`.
 */
export function verifyLegacyClaimProof(
	wgId: string,
	memberId: string,
	token: string | null | undefined,
): boolean {
	if (!token || !LEGACY_TOKEN_PATTERN.test(token)) return false;
	const providedBuf = Buffer.from(token, 'hex');
	let valid = false;
	for (const secret of acceptedSigningSecrets()) {
		const expectedBuf = createHmac('sha256', secret).update(`${wgId}:${memberId}`).digest();
		if (expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)) {
			valid = true;
		}
	}
	return valid;
}
