import { captureException } from '@/core/infra/observability';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis/cloudflare';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export function rateLimitFailMode(): 'open' | 'closed' {
	const standaloneProduction = process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV;
	return process.env.NODE_ENV === 'test' ||
		process.env.VERCEL_ENV === 'production' ||
		standaloneProduction
		? 'closed'
		: 'open';
}

export function createConfiguredRedis(): Redis | null {
	if (!url || !token) return null;
	try {
		if (new URL(url).protocol !== 'https:') {
			if (rateLimitFailMode() === 'closed') {
				throw new Error('UPSTASH_REDIS_REST_URL must use https');
			}
			return null;
		}
		return new Redis({ url, token });
	} catch {
		if (rateLimitFailMode() === 'closed') {
			throw new Error('UPSTASH_REDIS_REST_URL must be a valid https URL');
		}
		return null;
	}
}

const redis = createConfiguredRedis();

function build(limit: number, windowSec: number, prefix: string): Ratelimit | null {
	if (!redis) return null;
	return new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
		prefix: `manawg:${prefix}`,
		analytics: true,
	});
}

export const registerLimiter = build(3, 3600, 'reg'); // 3 / hour / IP
export const wgReadLimiter = build(120, 60, 'wg-read'); // 120 reads / min / IP — WG GET endpoints
export const wgWriteLimiter = build(30, 60, 'wg-write'); // 30 writes / min / IP — WG mutation endpoints
export const wgShareCodeLookupLimiter = build(20, 60, 'wg-code-lookup'); // 20 share-code lookups / min / IP — brute-force defense
export const notifTestLimiter = build(3, 60, 'notif-test'); // 3 test notifications / min / member — anti-spam
export const reminderSendLimiter = build(10, 3600, 'reminder-send'); // 10 Mahnungen / hour / member — global anti-spam

export const chatReadLimiter = build(120, 60, 'chat-read'); // 120 read-receipts / min / member
export const chatMessageLimiter = build(20, 60, 'chat-msg'); // 20 messages / min / member — anti-spam
export const uploadSignLimiter = build(20, 60, 'upload-sign'); // 20 upload signatures / min / member
// A single export request dumps the WG's entire dataset (expenses, chores,
// chat, announcements). The middleware's 120 reads/min is far too generous for
// that, so it gets its own bucket on top.
export const wgExportLimiter = build(20, 3600, 'wg-export'); // 20 exports / hour / member
// The dashboard aggregates the WG's financial state. The middleware's
// 120 reads/min is per IP and shared with every other GET, so the route gets
// its own per-member bucket: scraping balances stays throttled even from a
// rotating pool of IPs.
export const dashboardLimiter = build(60, 60, 'dashboard'); // 60 dashboard reads / min / member
export const healthLimiter = build(60, 60, 'health'); // 60 probes / min / IP — outside the middleware matcher
export const importLimiter = build(10, 3600, 'import-preview'); // 10 preview / hour / member
export const importCommitLimiter = build(3, 3600, 'import-commit'); // 3 commit / hour / member

function forwardedForClientIp(headers: Headers): string | null {
	const fwd = headers.get('x-forwarded-for');
	if (!fwd) return null;
	const values = fwd
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	return values.at(-1) ?? null;
}

// Per-IP key for the IP-scoped limiters (wgReadLimiter/wgWriteLimiter etc.).
// Keying on the share code instead would create one shared bucket per WG that
// any code-holder could exhaust pre-auth, locking out every member.
export function clientIpKey(req: { headers: Headers }): string {
	return (
		forwardedForClientIp(req.headers) ||
		req.headers.get('cf-connecting-ip') ||
		req.headers.get('x-real-ip') ||
		'anonymous'
	);
}

interface RateLimitResult {
	success: boolean;
	remaining: number;
	reset: number;
	limiterUnavailable?: boolean;
}

const FAIL_OPEN_PRODUCTION_LOG =
	'[rate-limit] Upstash Redis not configured in production — failing open';
const OPEN_STATE_REPORT_INTERVAL_MS = 5 * 60 * 1000;
const lastReportedAt = new Map<string, number>();

// Monotonic fail-open tally. Failing open is deliberate, but it must be
// measurable: a sustained Upstash outage or a standing misconfiguration
// silently disables every limiter while the API looks healthy. The report
// throttle below still dedupes the *alert*, but the counter counts every
// fail-open event so operators can alert on "rate limiting is disabled".
// Observational only — it never influences the allow/deny decision.
const failOpenTotals = new Map<string, number>();

export function getFailOpenStats(): {
	total: number;
	byCause: Record<string, number>;
} {
	const byCause: Record<string, number> = {};
	let total = 0;
	for (const [cause, count] of failOpenTotals) {
		byCause[cause] = count;
		total += count;
	}
	return { total, byCause };
}

/**
 * Failing open is deliberate, but it must not be invisible: an unthrottled API
 * looks perfectly healthy from the outside while every limit is off. Reported
 * at most once per interval per cause, so a sustained Upstash outage
 * produces a signal rather than one event per request.
 */
function reportOpenState(cause: string, error?: unknown): void {
	// Count every fail-open event, independent of the alert throttle below.
	failOpenTotals.set(cause, (failOpenTotals.get(cause) ?? 0) + 1);

	const isProduction = process.env.VERCEL_ENV === 'production';

	// An unconfigured limiter is only newsworthy in production; a limiter that
	// throws is a defect anywhere, so it is always logged.
	if (error !== undefined) {
		console.error('[rate-limit] limiter call failed, failing open:', error);
	} else if (isProduction) {
		console.error(FAIL_OPEN_PRODUCTION_LOG);
	}

	if (!isProduction) return;
	const now = Date.now();
	const previous = lastReportedAt.get(cause);
	if (previous !== undefined && now - previous < OPEN_STATE_REPORT_INTERVAL_MS) return;
	lastReportedAt.set(cause, now);

	captureException(
		error instanceof Error ? error : new Error(`rate-limit failing open: ${cause}`),
		{
			area: 'rate-limit',
			cause,
		},
	);
}

/** Test seam — the report throttle and fail-open tally are process-global state. */
export function resetOpenStateReporting(): void {
	lastReportedAt.clear();
	failOpenTotals.clear();
}

export async function checkRateLimit(
	limiter: Ratelimit | null,
	key: string,
	failMode: 'open' | 'closed' = rateLimitFailMode(),
): Promise<RateLimitResult> {
	if (!limiter) {
		reportOpenState('upstash-not-configured');
		if (failMode === 'closed') {
			return { success: false, remaining: 0, reset: Date.now() + 60_000, limiterUnavailable: true };
		}
		return { success: true, remaining: -1, reset: 0 };
	}
	try {
		const r = await limiter.limit(key);
		return { success: r.success, remaining: r.remaining, reset: r.reset };
	} catch (error) {
		reportOpenState('limiter-call-failed', error);
		if (failMode === 'closed') {
			return { success: false, remaining: 0, reset: Date.now() + 60_000, limiterUnavailable: true };
		}
		return { success: true, remaining: -1, reset: 0 };
	}
}
