/**
 * Content-Security-Policy and related header values applied by `proxy.ts`.
 * Kept out of the middleware so the policy can be unit-tested without Next.
 */

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
	const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'"];
	const styleSrc = ["'self'", `'nonce-${nonce}'`];
	const imgSrc = ["'self'", 'data:', 'blob:'];
	const connectSrc = ["'self'"];
	const workerSrc = ["'self'", 'blob:'];
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
