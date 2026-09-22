/**
 * Content-Security-Policy shared by both zones' middleware so the policy
 * can't drift between `web` and `landing` — they serve one origin and must
 * agree on what that origin is allowed to load.
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
function s3UploadOrigins(): string[] {
	const bucket = process.env.S3_BUCKET?.trim();
	const region = process.env.AWS_REGION?.trim();
	if (bucket && region) {
		return [`https://${bucket}.s3.${region}.amazonaws.com`, `https://${bucket}.s3.amazonaws.com`];
	}
	return ['https://*.s3.amazonaws.com'];
}

export function contentSecurityPolicy(nonce: string): string {
	const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", 'https://cdn.jsdelivr.net'];
	const styleSrc = ["'self'", `'nonce-${nonce}'`];
	const connectSrc = ["'self'", 'https://cdn.jsdelivr.net', ...s3UploadOrigins()];
	const workerSrc = ["'self'", 'blob:', 'https://cdn.jsdelivr.net'];
	const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
	if (posthogHost) {
		try {
			const apiOrigin = new URL(posthogHost);
			if (apiOrigin.protocol === 'https:') {
				connectSrc.push(apiOrigin.origin);
				const assetsOrigin = new URL(apiOrigin.origin);
				assetsOrigin.hostname = apiOrigin.hostname.replace('.i.', '-assets.i.');
				scriptSrc.push(assetsOrigin.origin);
			}
		} catch {
			// Invalid analytics configuration must not widen the policy.
		}
	}
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (supabaseUrl) {
		try {
			const authOrigin = new URL(supabaseUrl);
			if (authOrigin.protocol === 'https:') connectSrc.push(authOrigin.origin);
		} catch {
			// Invalid auth configuration must not widen the policy.
		}
	}
	if (process.env.NODE_ENV === 'development') {
		scriptSrc.push("'unsafe-eval'");
	}
	return [
		"default-src 'self'",
		`script-src ${scriptSrc.join(' ')}`,
		`style-src ${styleSrc.join(' ')}`,
		"style-src-attr 'unsafe-inline'",
		"img-src 'self' data: blob: https://*.amazonaws.com",
		"font-src 'self' data:",
		`connect-src ${connectSrc.join(' ')}`,
		"media-src 'self' blob: https://*.amazonaws.com",
		`worker-src ${workerSrc.join(' ')}`,
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"object-src 'none'",
		'upgrade-insecure-requests',
	].join('; ');
}
