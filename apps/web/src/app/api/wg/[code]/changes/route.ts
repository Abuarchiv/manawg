import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, wgChangeVersions } from '@/core/db';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import type { WgChangeVersions } from '@/core/sync/wg-changes';

/**
 * The one poll an open WG tab sends: the versions of the list data, the member roster and the
 * chat. The client refetches only what moved. A removed member gets the guard's 401 here, as
 * the members poll answered before.
 */
export const GET = withWgRoute('changes GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const [row] = await db
		.select({
			data: wgChangeVersions.dataVersion,
			members: wgChangeVersions.membersVersion,
			chat: wgChangeVersions.chatVersion,
		})
		.from(wgChangeVersions)
		.where(eq(wgChangeVersions.wgId, auth.wg.id))
		.limit(1);
	const versions: WgChangeVersions = {
		data: String(row?.data ?? 0),
		members: String(row?.members ?? 0),
		chat: String(row?.chat ?? 0),
	};
	return NextResponse.json(versions, { headers: { 'Cache-Control': 'private, no-store' } });
});
