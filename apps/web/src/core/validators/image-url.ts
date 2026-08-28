import { z } from 'zod';

const URL_MAX = 2048;

function getAllowedHosts(): string[] {
	const hosts = new Set<string>();
	const publicUrl = process.env.S3_PUBLIC_URL;
	if (publicUrl) {
		try {
			hosts.add(new URL(publicUrl).host);
		} catch {
			// ignore malformed env
		}
	}
	const bucket = process.env.S3_BUCKET;
	const region = process.env.AWS_REGION;
	if (bucket && region) {
		hosts.add(`${bucket}.s3.${region}.amazonaws.com`);
		hosts.add(`${bucket}.s3.amazonaws.com`);
	}
	return [...hosts];
}

export function isAllowedImageHost(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'https:') return false;
	const allowed = getAllowedHosts();
	if (allowed.length === 0) {
		return false;
	}
	return allowed.includes(parsed.host);
}

/**
 * Zod schema for user-supplied image URLs stored in expenses/announcements.
 *
 * Empty string is treated as "no image" (legacy clients send '' instead of null).
 * Non-empty strings must be https:// and point at our S3 bucket — blocks
 * `javascript:`, `data:`, and attacker-controlled hosts that the CSP `img-src`
 * already restricts but which we never want to persist.
 */
export const imageUrlSchema = z
	.string()
	.max(URL_MAX)
	.refine((v) => v.length === 0 || isAllowedImageHost(v), {
		message: 'image_url_not_allowed',
	})
	.optional()
	.nullable();
