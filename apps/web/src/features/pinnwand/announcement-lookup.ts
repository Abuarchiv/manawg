import { announcements, db } from '@/core/db';
import { and, eq } from 'drizzle-orm';

interface AnnouncementRef {
	id: string;
	authorMemberId: string;
	content: string;
	status: string;
}

/**
 * Read one announcement, scoped to its WG.
 *
 * The WG scope is the point: without it, any member could act on an
 * announcement id belonging to a different WG. The comment and reaction routes
 * each carried an identical copy of this query.
 */
export async function findWgAnnouncement(
	wgId: string,
	announcementId: string,
): Promise<AnnouncementRef | undefined> {
	const rows = await db
		.select({
			id: announcements.id,
			authorMemberId: announcements.authorMemberId,
			content: announcements.content,
			status: announcements.status,
		})
		.from(announcements)
		.where(and(eq(announcements.id, announcementId), eq(announcements.wgId, wgId)))
		.limit(1);
	return rows[0];
}
