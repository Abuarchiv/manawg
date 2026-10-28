/**
 * `fetch` for server-side Supabase clients. A self-hosted stack sets `SUPABASE_INTERNAL_URL`
 * (e.g. `http://gateway:8000`): requests to the public Supabase origin then travel over the
 * container network, while the clients keep the public URL for everything the browser sees
 * (OAuth redirects, signed upload URLs, cookie names). Unset, this is plain `fetch`.
 */
export function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const internal = process.env.SUPABASE_INTERNAL_URL?.trim().replace(/\/$/, '');
	const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
	if (!internal || !publicUrl) return fetch(input, init);

	const publicOrigin = new URL(publicUrl).origin;
	const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	if (href !== publicOrigin && !href.startsWith(`${publicOrigin}/`)) return fetch(input, init);

	const rewritten = `${internal}${href.slice(publicOrigin.length)}`;
	return fetch(input instanceof Request ? new Request(rewritten, input) : rewritten, init);
}
