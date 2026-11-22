import { NextResponse } from 'next/server';
import { readWgChangeVersions } from '@/core/db/change-versions';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';

/**
 * The one poll an open WG tab sends: the versions of the list data, the member roster and the
 * chat. The client refetches only what moved. A removed member gets the guard's 401 here, as
 * the members poll answered before.
 */
export const GET = withWgRoute('changes GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	return NextResponse.json(await readWgChangeVersions(auth.wg.id), {
		headers: { 'Cache-Control': 'private, no-store' },
	});
});
