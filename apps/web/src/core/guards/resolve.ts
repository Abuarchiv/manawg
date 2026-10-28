import { and, eq } from 'drizzle-orm';
import { db, wgMembers, wgs } from '@/core/db';

/** A WG row, narrowed to the columns the API routes consume. */
export interface ResolvedWg {
	id: string;
	name: string;
	shareCode: string;
	createdAt: Date;
}

export interface ResolvedWgMembership extends ResolvedWg {
	/** The caller's row in this WG, moved-out included; null when they never belonged to it. */
	member: { id: string; name: string; deactivatedAt: Date | null } | null;
}

/**
 * The WG behind a share code together with the caller's membership in one round trip (the
 * `(wg_id, auth_user_id)` unique index yields at most one member row). Returns `null` for an
 * unknown code. Routes go through `requireWgMember`, which turns the row into the guard answer.
 */
export async function resolveWg(
	code: string,
	authUserId: string,
): Promise<ResolvedWgMembership | null> {
	const [row] = await db
		.select({
			id: wgs.id,
			name: wgs.name,
			shareCode: wgs.shareCode,
			createdAt: wgs.createdAt,
			memberId: wgMembers.id,
			memberName: wgMembers.name,
			memberDeactivatedAt: wgMembers.deactivatedAt,
		})
		.from(wgs)
		.leftJoin(wgMembers, and(eq(wgMembers.wgId, wgs.id), eq(wgMembers.authUserId, authUserId)))
		.where(eq(wgs.shareCode, code))
		.limit(1);
	if (!row) return null;
	const { memberId, memberName, memberDeactivatedAt, ...wg } = row;
	return {
		...wg,
		member:
			memberId !== null && memberName !== null
				? { id: memberId, name: memberName, deactivatedAt: memberDeactivatedAt }
				: null,
	};
}
