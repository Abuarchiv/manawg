import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * Constant-time check of the cron endpoint's `Authorization: Bearer <secret>`
 * header against `CRON_SECRET`. A plain `!==` string compare leaks timing
 * information proportional to the matching prefix length; cron endpoints
 * trigger real side effects (notification dispatch, recurring-expense
 * creation) so the comparison is constant-time.
 */
export function verifyCronSecret(authorizationHeader: string | null, secret: string): boolean {
	const expected = Buffer.from(`Bearer ${secret}`);
	const provided = Buffer.from(authorizationHeader ?? '');
	if (expected.length !== provided.length) return false;
	return timingSafeEqual(expected, provided);
}

/**
 * The guard every cron route opens with. Fails CLOSED: without `CRON_SECRET`
 * the endpoint would be world-callable (anyone could enumerate WGs and trigger
 * notifications or bookings), so a missing secret answers 503 rather than
 * skipping the check. Returns `null` when the caller may proceed.
 */
export function requireCronSecret(req: Request): NextResponse | null {
	const secret = process.env.CRON_SECRET;
	if (!secret) return new NextResponse('cron_secret_missing', { status: 503 });
	if (!verifyCronSecret(req.headers.get('authorization'), secret)) {
		return new NextResponse('unauthorized', { status: 401 });
	}
	return null;
}
