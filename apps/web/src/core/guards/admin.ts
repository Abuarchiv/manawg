import { db, wgMembers } from '@/core/db';
import { forbidden } from '@/core/http/api-errors';
import { and, eq, isNull } from 'drizzle-orm';
import type { NextResponse } from 'next/server';

/**
 * The admin is the active member with the explicit `admin` role.
 * Returns `true` iff `memberId` holds that role in the WG.
 * Shared by API routes that need to gate destructive/owner-overriding
 * actions (e.g. announcement.delete admin override, chore.delete,
 * absence.delete cross-member). See app/api/wg/[code]/* DELETE handlers.
 *
 * Applies the same active-member policy as the rest of the app
 * (`isNull(wgMembers.deactivatedAt)`). Membership age never changes the role.
 */
export async function isWgAdmin(wgId: string, memberId: string): Promise<boolean> {
	const rows = await db
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(
			and(eq(wgMembers.wgId, wgId), eq(wgMembers.role, 'admin'), isNull(wgMembers.deactivatedAt)),
		)
		.limit(1);
	return rows[0]?.id === memberId;
}

/**
 * Same admin check as `isWgAdmin`, but also requires a server-verified
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
 * server-verified membership in addition to holding the explicit admin role.
 * HMAC member tokens are limited to the explicit legacy-claim flow. A
 * request that only matched `x-manawg-member-id` ("legacy") is rejected
 * with `not_verified` even if that id belongs to the real admin — a bare
 * id is spoofable (e.g. harvested from GET /api/wg/[code]/members) and is
 * no longer sufficient proof of identity for destructive actions.
 */
/**
 * Owner-or-admin gate shared by the resource DELETE/PATCH handlers that let
 * either the resource's own creator/author or the WG admin act on it (see
 * app/api/wg/[code]/{absences,events,announcements,chat/messages,members,
 * recurring-expenses,chores}/[id]/route.ts). Ownership requires a verified
 * caller — a bare `x-manawg-member-id` is spoofable, so an unverified caller
 * can never pass as the owner even if the ids match.
 *
 * Returns `null` when the caller is allowed to proceed, or the `forbidden`
 * response to return immediately otherwise.
 */
export async function requireOwnerOrAdmin(
	wgId: string,
	member: { memberId: string; verified: boolean },
	ownerId: string | null,
	reason = 'not_owner',
): Promise<NextResponse | null> {
	const isOwner = member.verified && ownerId === member.memberId;
	if (isOwner) return null;
	if (await isVerifiedWgAdmin(wgId, member.memberId, member.verified)) return null;
	return forbidden(reason, reason);
}

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
