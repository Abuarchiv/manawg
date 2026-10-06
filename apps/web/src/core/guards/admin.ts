import { db, wgMembers } from '@/core/db';
import { forbidden } from '@/core/http/api-errors';
import { and, eq, isNull } from 'drizzle-orm';
import type { NextResponse } from 'next/server';

/**
 * The admin is the active member with the explicit `admin` role.
 * Returns `true` iff `memberId` holds that role in the WG.
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
 * Owner-or-admin gate for resource handlers that let either the resource's
 * creator/author or the WG admin act on it. `member` is the caller resolved by
 * `requireMember`, so matching ids already prove ownership.
 *
 * Returns `null` when the caller may proceed, or the `forbidden` response to
 * return immediately otherwise.
 */
export async function requireOwnerOrAdmin(
	wgId: string,
	member: { memberId: string },
	ownerId: string | null,
	reason = 'not_owner',
): Promise<NextResponse | null> {
	if (ownerId === member.memberId) return null;
	if (await isWgAdmin(wgId, member.memberId)) return null;
	return forbidden(reason, reason);
}
