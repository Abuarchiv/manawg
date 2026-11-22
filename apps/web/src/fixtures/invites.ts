import { type NextRequest, NextResponse } from 'next/server';
import { apiError, HTTP, notFound } from '@/core/http/api-errors';
import { INVITE_VALID_DAYS, invitePath } from '@/core/utils/invite-token';
import { MS_PER_DAY } from '@/core/utils/time';
import {
	E2E_EXISTING_WG,
	E2E_EXPIRED_INVITE_TOKEN,
	E2E_INVITE_TOKEN,
	type E2EWgFixture,
} from './data';

/** `GET /api/wg/invites/[token]`: one valid, one expired fixture invitation, anything else unknown. */
export function inviteLookup(token: string): NextResponse {
	if (token === E2E_INVITE_TOKEN) {
		return NextResponse.json({
			wg: { name: E2E_EXISTING_WG.name, shareCode: E2E_EXISTING_WG.shareCode },
			expiresAt: new Date(Date.now() + INVITE_VALID_DAYS * MS_PER_DAY).toISOString(),
		});
	}
	if (token === E2E_EXPIRED_INVITE_TOKEN)
		return apiError('invite_expired', HTTP.GONE, 'invite_expired');
	return notFound('invite_invalid', 'invite_invalid');
}

/** `GET /api/wg/invites/[token]/preview`: the guest page's teaser; unusable tokens get the bare 404. */
export function invitePreview(token: string): NextResponse {
	if (token !== E2E_INVITE_TOKEN) return notFound('invite_unavailable', 'invite_unavailable');
	return NextResponse.json({ wgName: E2E_EXISTING_WG.name, inviterName: 'Mika', memberCount: 2 });
}

/**
 * `POST /api/wg/[code]/invites/current`: a single-member WG's newest fixture invitation is the
 * expired one, so its invite card gets the fresh, joinable link; a WG with flatmates gets none.
 */
export function currentInvite(req: NextRequest, fixture: E2EWgFixture): NextResponse {
	if (fixture.members.length !== 1) return NextResponse.json({ invite: null });
	return NextResponse.json({
		invite: {
			id: '6c2e7a51-8d4b-4f0a-9b3e-5a1d2c3b4e5f',
			url: `${req.nextUrl.origin}${invitePath(E2E_INVITE_TOKEN)}`,
			expiresAt: new Date(Date.now() + INVITE_VALID_DAYS * MS_PER_DAY).toISOString(),
		},
	});
}
