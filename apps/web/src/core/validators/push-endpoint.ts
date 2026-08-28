import { z } from 'zod';

const URL_MAX = 2048;

/**
 * The push services browsers actually hand out endpoints for. A subscription
 * endpoint is a server-side fetch target — `notification-dispatch.ts` POSTs to
 * whatever is stored here on every WG event — so an unrestricted URL would let
 * any member point the server at an internal address (cloud metadata, an
 * internal service) and trigger the request at will. Same reasoning as
 * `image-url.ts`, which allowlists the S3 host for the same class of problem.
 *
 * Exact hosts where the service uses one, suffixes where it shards across
 * subdomains (Edge's `wns2-*.notify.windows.com`, Apple's regional hosts).
 */
const ALLOWED_HOSTS = new Set([
	'fcm.googleapis.com',
	'updates.push.services.mozilla.com',
	'web.push.apple.com',
]);

const ALLOWED_HOST_SUFFIXES = [
	'.notify.windows.com',
	'.push.services.mozilla.com',
	'.push.apple.com',
];

export function isAllowedPushEndpoint(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'https:') return false;
	// `host` includes a port; a push service never needs one, and allowing it
	// would let `fcm.googleapis.com:22` through the hostname check.
	if (parsed.port !== '') return false;

	const host = parsed.hostname.toLowerCase();
	if (ALLOWED_HOSTS.has(host)) return true;
	return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Only applied when storing a NEW subscription. Unsubscribe deliberately keeps
 * accepting any URL, so a client can still delete a row that predates this
 * check.
 */
export const pushEndpointSchema = z
	.string()
	.url()
	.max(URL_MAX)
	.refine(isAllowedPushEndpoint, { message: 'push_endpoint_not_allowed' });
