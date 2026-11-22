import { NextResponse } from 'next/server';
import { apiError, HTTP, notFound } from '@/core/http/api-errors';
import { INVITE_VALID_DAYS, type InvitePreview } from '@/core/utils/invite-token';
import { MS_PER_DAY } from '@/core/utils/time';
import { E2E_EXISTING_WG, E2E_EXPIRED_INVITE_TOKEN, E2E_INVITE_TOKEN } from './data';
import { isE2EDbDownMode } from './mode';

const PREVIEW: InvitePreview = {
	wgName: E2E_EXISTING_WG.name,
	inviterName: 'Mika',
	memberCount: 2,
};

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
	return NextResponse.json(PREVIEW);
}

/**
 * The invitation preview for server-rendered pages in the database-free build: the fixture
 * preview for the valid token, null for any other. `undefined` means this is a real build and the
 * caller looks the token up in the database.
 */
export function fixtureInvitePreview(token: string): InvitePreview | null | undefined {
	if (!isE2EDbDownMode()) return undefined;
	return token === E2E_INVITE_TOKEN ? PREVIEW : null;
}
