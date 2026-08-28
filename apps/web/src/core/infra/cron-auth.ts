import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time check of the cron endpoint's `Authorization: Bearer <secret>`
 * header against `CRON_SECRET`. A plain `!==` string compare leaks timing
 * information proportional to the matching prefix length; cron endpoints
 * trigger real side effects (notification dispatch, recurring-expense
 * creation) so the comparison is hardened the same way member tokens are
 * (see `@/core/guards/member-token`).
 */
export function verifyCronSecret(authorizationHeader: string | null, secret: string): boolean {
	const expected = Buffer.from(`Bearer ${secret}`);
	const provided = Buffer.from(authorizationHeader ?? '');
	if (expected.length !== provided.length) return false;
	return timingSafeEqual(expected, provided);
}
