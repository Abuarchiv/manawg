/**
 * Content-Security-Policy and related header values applied by `middleware.ts`.
 * Kept out of the middleware so the policy can be unit-tested without Next.
 */
/**
 * `connect-src` origins the browser may reach beyond this origin.
 *
 * Concrete hosts only: provider wildcards (`*.amazonaws.com`, `*.neon.tech`,
 * `*.vercel-storage.com`) would let any compromised subdomain of those
 * services receive exfiltrated data. The S3 upload target is derived from the
 * same configuration `s3.ts` signs with, so the presigned PUT always has an
 * exact origin in the policy — and with nothing configured there is no upload
 * target to allow at all, only the bucket-scoped legacy endpoint.
 */
function usesSupabaseImageStorage(): boolean {
	return process.env.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase() === 'supabase';
}

function s3UploadOrigins(): string[] {
	// Uploads go to Supabase Storage (its origin is added below), so S3 is no upload target.
	// Pictures stored earlier at public S3 URLs stay readable through `img-src`.
	if (usesSupabaseImageStorage()) return [];
	const bucket = process.env.S3_BUCKET?.trim();
	const region = process.env.AWS_REGION?.trim();
	if (bucket && region) {
		return [`https://${bucket}.s3.${region}.amazonaws.com`, `https://${bucket}.s3.amazonaws.com`];
	}
	return ['https://*.s3.amazonaws.com'];
}

const PAYPAL_FRAME_CONNECT_ORIGINS = ['https://www.paypal.com', 'https://www.sandbox.paypal.com'];
// Tesseract.js 5.1.1's default German and English model URLs. Keep CDN access
// pinned to these files rather than allowing all of cdn.jsdelivr.net.
const TESSERACT_LANGUAGE_DATA_URLS = [
	'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz',
	'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
];

/** An invalid or non-HTTPS provider URL must not widen the policy. */
function httpsOrigin(value: string | undefined): URL | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url : null;
	} catch {
		return null;
	}
}

export function isPayPalSdkEnabled(
	clientId: string | undefined,
	partnerAttributionId: string | undefined,
): boolean {
	return Boolean(clientId?.trim() && partnerAttributionId?.trim());
}

export function crossOriginOpenerPolicy(
	payPalSdkEnabled: boolean,
): 'same-origin' | 'same-origin-allow-popups' {
	return payPalSdkEnabled ? 'same-origin-allow-popups' : 'same-origin';
}

export function contentSecurityPolicy(
	nonce: string,
	upgradeInsecureRequests = true,
	payPalSdkEnabled = isPayPalSdkEnabled(
		process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
		process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
	),
): string {
	const scriptSrc = [
		"'self'",
		`'nonce-${nonce}'`,
		"'strict-dynamic'",
		"'wasm-unsafe-eval'",
		'https://cdn.jsdelivr.net',
	];
	const styleSrc = ["'self'", `'nonce-${nonce}'`];
	const imgSrc = ["'self'", 'data:', 'blob:', 'https://*.amazonaws.com'];
	// Only the pinned Tesseract language files are CDN fetch targets. Do not add
	// the broader CDN origin to connect-src, which would permit unrelated fetches.
	const connectSrc = ["'self'", ...s3UploadOrigins(), ...TESSERACT_LANGUAGE_DATA_URLS];
	const workerSrc = ["'self'", 'blob:', 'https://cdn.jsdelivr.net'];
	if (payPalSdkEnabled) {
		connectSrc.push(...PAYPAL_FRAME_CONNECT_ORIGINS);
	}
	const posthogOrigin = httpsOrigin(process.env.NEXT_PUBLIC_POSTHOG_HOST);
	if (posthogOrigin) {
		connectSrc.push(posthogOrigin.origin);
		const assetsOrigin = new URL(posthogOrigin.origin);
		assetsOrigin.hostname = posthogOrigin.hostname.replace('.i.', '-assets.i.');
		scriptSrc.push(assetsOrigin.origin);
	}
	const supabaseOrigin = httpsOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
	if (supabaseOrigin) connectSrc.push(supabaseOrigin.origin);
	const sentryOrigin = httpsOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);
	if (sentryOrigin) connectSrc.push(sentryOrigin.origin);
	if (process.env.NODE_ENV === 'development') {
		scriptSrc.push("'unsafe-eval'");
	}
	return [
		"default-src 'self'",
		`script-src ${scriptSrc.join(' ')}`,
		`style-src ${styleSrc.join(' ')}`,
		"style-src-attr 'unsafe-inline'",
		`img-src ${imgSrc.join(' ')}`,
		"font-src 'self' data:",
		`connect-src ${connectSrc.join(' ')}`,
		...(payPalSdkEnabled ? [`frame-src 'self' ${PAYPAL_FRAME_CONNECT_ORIGINS.join(' ')}`] : []),
		"media-src 'self' blob: https://*.amazonaws.com",
		`worker-src ${workerSrc.join(' ')}`,
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"object-src 'none'",
		...(upgradeInsecureRequests ? ['upgrade-insecure-requests'] : []),
	].join('; ');
}
