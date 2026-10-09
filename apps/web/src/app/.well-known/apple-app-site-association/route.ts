import { NextResponse } from 'next/server';

/**
 * Apple App Site Association (AASA) endpoint.
 *
 * Served at `/.well-known/apple-app-site-association` (no `.json` extension,
 * exact `application/json` content-type — Apple enforces both).
 *
 * Returns 404 unless both `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID` env vars are
 * configured. No native iOS app currently exists, so the route stays inactive
 * by default rather than serving a placeholder Team ID.
 *
 * Powers (when enabled):
 *   - `webcredentials` → native Passkey association for the configured bundle.
 *   - `applinks`       → Universal Links for /transfer/redeem and /join/*.
 */

export function GET(): NextResponse {
	const teamId = process.env.APPLE_TEAM_ID?.trim();
	const bundleId = process.env.APPLE_BUNDLE_ID?.trim();

	if (!teamId || !bundleId) {
		return new NextResponse(null, { status: 404 });
	}

	const appId = `${teamId}.${bundleId}`;

	const aasa = {
		webcredentials: {
			apps: [appId],
		},
		applinks: {
			details: [
				{
					appIDs: [appId],
					components: [
						{ '/': '/transfer/redeem', comment: 'transfer redeem deeplink' },
						{ '/': '/join/*', comment: 'WG-Einladungs-Deeplink' },
					],
				},
			],
		},
	};

	return NextResponse.json(aasa, {
		status: 200,
		headers: {
			'content-type': 'application/json',
			'cache-control': 'public, max-age=300',
		},
	});
}
