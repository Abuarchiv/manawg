import { NextResponse } from 'next/server';
import { readWgChangeVersions } from '@/core/db/change-versions';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { waitForChange } from '@/core/sync/wait-for-change';

/** A long poll answers within this, under the client's 15-s request timeout. */
const WAIT_MS = 10_000;
/** How often a long poll reads the versions: the delay before a join or revoke shows. */
const WAIT_STEP_MS = 1000;
export const maxDuration = 30;
const VERSION = /^\d{1,20}$/;

/**
 * The one poll an open WG tab sends: the versions of the list data, the member roster and the
 * chat. The client refetches only what moved. A removed member gets the guard's 401 here, as
 * the members poll answered before. With `members` and `data` (the versions the caller holds) it
 * is a long poll that answers once either moves: the open invite card's live channel.
 */
export const GET = withWgRoute('changes GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const params = new URL(req.url).searchParams;
	const members = params.get('members') ?? '';
	const data = params.get('data') ?? '';
	const read = () => readWgChangeVersions(wgId);
	const versions =
		VERSION.test(members) && VERSION.test(data)
			? await waitForChange(
					read,
					{ members, data },
					{
						timeoutMs: WAIT_MS,
						stepMs: WAIT_STEP_MS,
						signal: req.signal,
					},
				)
			: await read();
	return NextResponse.json(versions, { headers: { 'Cache-Control': 'private, no-store' } });
});
