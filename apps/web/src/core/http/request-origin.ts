/**
 * The origin the visitor used. Behind a reverse proxy with `next start` (the Docker image),
 * `request.url` names the server's bind address (`http://0.0.0.0:3000`), so the proxy's
 * `X-Forwarded-Host`/`-Proto` win; on Vercel they carry the same origin as `request.url`.
 */
export function requestOrigin(request: { url: string; headers: Headers }): string {
	const url = new URL(request.url);
	const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
	if (!host) return url.origin;
	const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
	const proto =
		forwardedProto === 'http' || forwardedProto === 'https'
			? forwardedProto
			: url.protocol.slice(0, -1);
	try {
		return new URL(`${proto}://${host}`).origin;
	} catch {
		return url.origin;
	}
}
