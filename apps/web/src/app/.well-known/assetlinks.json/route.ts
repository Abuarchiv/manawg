import { NextResponse } from 'next/server';

/**
 * Android Digital Asset Links endpoint.
 *
 * Served at `/.well-known/assetlinks.json`. Returns 404 unless
 * `ANDROID_SHA256_FINGERPRINTS` is set. Package name comes from
 * `ANDROID_PACKAGE_NAME`; fingerprints are comma-separated.
 *
 * Powers (when enabled):
 *   - `delegate_permission/common.handle_all_urls` → App-Links
 *     auto-verification so deeplinks open the native app directly.
 *   - `delegate_permission/common.get_login_creds` → Passkey credential
 *     delegation between the website and the Android package.
 */

export function GET(): NextResponse {
	const rawFingerprints = process.env.ANDROID_SHA256_FINGERPRINTS?.trim();
	const packageName = process.env.ANDROID_PACKAGE_NAME?.trim();

	if (!rawFingerprints || !packageName) {
		return new NextResponse(null, { status: 404 });
	}

	const fingerprints = rawFingerprints
		.split(',')
		.map((fp) => fp.trim())
		.filter((fp) => fp.length > 0);

	if (fingerprints.length === 0) {
		return new NextResponse(null, { status: 404 });
	}

	const assetLinks = [
		{
			relation: [
				'delegate_permission/common.handle_all_urls',
				'delegate_permission/common.get_login_creds',
			],
			target: {
				namespace: 'android_app',
				package_name: packageName,
				sha256_cert_fingerprints: fingerprints,
			},
		},
	];

	return NextResponse.json(assetLinks, {
		status: 200,
		headers: {
			'content-type': 'application/json',
			'cache-control': 'public, max-age=300',
		},
	});
}
