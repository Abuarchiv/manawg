import 'server-only';

import { getAuthenticatedUserFromCookies } from '@/core/auth/server';
import { db, wgMembers, wgs } from '@/core/db';
import { and, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';

/**
 * Session user plus the share code's WG, for server components.
 * `access` is null unless the user is an active member of that WG, so a page
 * that answers `notFound()` on a null `access` reveals nothing about codes the
 * visitor does not belong to. Memoized per request: the session check is a
 * network call to Supabase Auth.
 *
 * `code` must already be normalized and validated.
 */
export const loadWgViewer = cache(async (code: string) => {
	const user = await getAuthenticatedUserFromCookies();
	if (!user) return null;
	const [access] = await db
		.select({
			id: wgs.id,
			name: wgs.name,
			shareCode: wgs.shareCode,
			memberId: wgMembers.id,
			memberName: wgMembers.name,
		})
		.from(wgMembers)
		.innerJoin(wgs, eq(wgMembers.wgId, wgs.id))
		.where(
			and(
				eq(wgs.shareCode, code),
				eq(wgMembers.authUserId, user.id),
				isNull(wgMembers.deactivatedAt),
			),
		)
		.limit(1);
	return { user, access: access ?? null };
});
