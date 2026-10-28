/**
 * Content-Security-Policy and related header values applied by `middleware.ts`.
 * Kept out of the middleware so the policy can be unit-tested without Next.
 */
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

export function contentSecurityPolicy(nonce: string, upgradeInsecureRequests = true): string {
	const scriptSrc = [
		"'self'",
		`'nonce-${nonce}'`,
		"'strict-dynamic'",
		"'wasm-unsafe-eval'",
		'https://cdn.jsdelivr.net',
	];
	const styleSrc = ["'self'", `'nonce-${nonce}'`];
	const imgSrc = ["'self'", 'data:', 'blob:'];
	// Only the pinned Tesseract language files are CDN fetch targets. Do not add
	// the broader CDN origin to connect-src, which would permit unrelated fetches.
	const connectSrc = ["'self'", ...TESSERACT_LANGUAGE_DATA_URLS];
	const workerSrc = ["'self'", 'blob:', 'https://cdn.jsdelivr.net'];
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
		"media-src 'self' blob:",
		`worker-src ${workerSrc.join(' ')}`,
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"object-src 'none'",
		...(upgradeInsecureRequests ? ['upgrade-insecure-requests'] : []),
	].join('; ');
}
