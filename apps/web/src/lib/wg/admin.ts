import { db, wgMembers } from '@/lib/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

/**
 * Soft admin check until we add a proper `role` column to `wg_members`.
 * The "admin" is the oldest member (smallest createdAt) of the WG —
 * i.e. the original creator. Returns `true` iff `memberId` is that member.
 * Shared by API routes that need to gate destructive/owner-overriding
 * actions (e.g. announcement.delete admin override, chore.delete,
 * absence.delete cross-member). See app/api/wg/[code]/* DELETE handlers.
 *
 * Applies the same active-member policy as the rest of the app
 * (`isNull(wgMembers.deactivatedAt)`): a moved-out member is never the
 * admin, even if they were the original creator — the oldest still-active
 * member takes over. With no active members left there is no admin.
 */
export async function isWgAdmin(wgId: string, memberId: string): Promise<boolean> {
	const rows = await db
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(and(eq(wgMembers.wgId, wgId), isNull(wgMembers.deactivatedAt)))
		.orderBy(asc(wgMembers.createdAt))
		.limit(1);
	return rows[0]?.id === memberId;
}

/**
 * Same admin check as `isWgAdmin`, but also requires a verified (HMAC-backed)
 * caller — for override actions where the target member differs from the
 * caller (e.g. deleting someone else's chore/event/announcement). A bare
 * `x-manawg-member-id` header is spoofable once the admin's UUID has leaked
 * via any authored-content field (createdByMemberId, etc.), so unverified
 * requests must not receive admin-tier override power.
 */
export async function isVerifiedWgAdmin(
	wgId: string,
	memberId: string,
	verified: boolean,
): Promise<boolean> {
	if (!verified) return false;
	return isWgAdmin(wgId, memberId);
}

type WgAdminDenyReason = 'not_verified' | 'not_admin';

interface WgAdminAccessResult {
	allowed: boolean;
	reason?: WgAdminDenyReason;
}

/**
 * Gate for the WG-level admin mutations (delete WG, rename, rotate share
 * code, toggle joining — see app/api/wg/[code]/route.ts PATCH/DELETE).
 *
 * These are the highest-blast-radius actions in the app (DELETE hard-drops
 * the `wgs` row for every member), so — unlike `isWgAdmin`, which many
 * lower-stakes admin-override actions still call directly — this requires
 * `verified` (a valid `x-manawg-member-token` HMAC, see
 * `@/lib/wg/member-token`) in addition to being the oldest member. A
 * request that only matched `x-manawg-member-id` ("legacy") is rejected
 * with `not_verified` even if that id belongs to the real admin — a bare
 * id is spoofable (e.g. harvested from GET /api/wg/[code]/members) and is
 * no longer sufficient proof of identity for destructive actions.
 */
export async function checkWgAdminAccess(
	wgId: string,
	memberId: string,
	verified: boolean,
): Promise<WgAdminAccessResult> {
	if (!verified) {
		return { allowed: false, reason: 'not_verified' };
	}
	const admin = await isWgAdmin(wgId, memberId);
	if (!admin) {
		return { allowed: false, reason: 'not_admin' };
	}
	return { allowed: true };
}
