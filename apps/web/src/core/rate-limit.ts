import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis/cloudflare';
import { captureException } from '@/core/infra/observability';
import { createMemoryLimiter } from './memory-rate-limit';

/**
 * An empty or whitespace-only variable is *configured but unusable* — a typo
 * in the deployment environment, not an intentional "no Redis" choice. Read it
 * as unset so the documented fail-open/fail-closed handling still applies, but
 * name the exact variable instead of failing open without a trace: `checkEnv`
 * only reports these two as generically "degraded" at boot.
 */
function readUpstashSetting(name: string, value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		// The fixture scripts blank these variables on purpose, so fixture mode stays quiet.
		if (process.env.E2E_FIXTURE_MODE === 'true') return undefined;
		console.warn(
			`[rate-limit] ${name} is set but empty — rate limiting stays disabled until it holds a value.`,
		);
		return undefined;
	}
	return trimmed;
}

const url = readUpstashSetting('UPSTASH_REDIS_REST_URL', process.env.UPSTASH_REDIS_REST_URL);
const token = readUpstashSetting('UPSTASH_REDIS_REST_TOKEN', process.env.UPSTASH_REDIS_REST_TOKEN);

export function rateLimitFailMode(): 'open' | 'closed' {
	const standaloneProduction = process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV;
	return process.env.NODE_ENV === 'test' ||
		process.env.VERCEL_ENV === 'production' ||
		standaloneProduction
		? 'closed'
		: 'open';
}

// A configured but unusable Upstash setup (a bad URL, or only one of URL and token); Preview
// answers it closed so the mistake shows up there. Neither variable set is a deliberate choice.
let configuredButInvalid = (url === undefined) !== (token === undefined);

function createConfiguredRedis(): Redis | null {
	if (!url || !token) return null;
	try {
		const endpoint = new URL(url);
		if (
			endpoint.protocol !== 'https:' ||
			endpoint.username ||
			endpoint.password ||
			endpoint.search ||
			endpoint.hash
		) {
			if (rateLimitFailMode() === 'closed') {
				throw new Error('UPSTASH_REDIS_REST_URL must use https');
			}
			configuredButInvalid = true;
			return null;
		}
		return new Redis({ url, token, enableTelemetry: false });
	} catch {
		if (rateLimitFailMode() === 'closed') {
			throw new Error('UPSTASH_REDIS_REST_URL must be a valid https URL');
		}
		configuredButInvalid = true;
		return null;
	}
}

const redis = createConfiguredRedis();

/**
 * A standalone server (Docker, `next start` outside Vercel) without Upstash counts in memory: it
 * is one long-lived process, so a per-process limit is real. Vercel's many short-lived instances
 * cannot share memory and keep the fail-open/fail-closed handling instead.
 */
const useMemoryLimiter =
	!redis &&
	!configuredButInvalid &&
	process.env.NODE_ENV === 'production' &&
	!process.env.VERCEL_ENV;

/** What `checkRateLimit` needs from a limiter: Upstash's `Ratelimit` or the memory one. */
interface RateLimiter {
	limit(
		key: string,
	): Promise<{ success: boolean; remaining: number; reset: number; reason?: string }>;
}

function build(limit: number, windowSec: number, prefix: string): RateLimiter | null {
	if (!redis) return useMemoryLimiter ? createMemoryLimiter(limit, windowSec) : null;
	return new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
		prefix: `manawg:${prefix}`,
		analytics: false,
		enableTelemetry: false,
	});
}

// 10 / hour / IP: a flat signs up together on one Wi-Fi; the fourth member must not wait an hour.
export const registerLimiter = build(10, 3600, 'reg');
// Credential guessing and auth mails: 20 / 5 min / IP across /api/auth/* (a household behind one router stays far below it)
export const authAttemptLimiter = build(20, 300, 'auth-attempt');
// 300 reads / min / session — WG GET endpoints. Every page load fans out to about eight module
// reads, so this allows ~37 navigations a minute; reads need a valid session, the share-code
// lookup has its own limiter.
export const wgReadLimiter = build(300, 60, 'wg-read');
// 60 writes / min / session — WG mutation endpoints. A shopping trip (typing the list, ticking it
// off) reaches 30 within a minute; chat, mails, uploads and reminders keep their own tighter
// limits, and the IP backstop below still caps a whole household.
export const wgWriteLimiter = build(60, 60, 'wg-write');
// Every full page load of a WG does one lookup, and flatmates share their router's IP, so the
// limit must stay generous. With 32^8 codes, one IP at 120/min still needs ~17,000 years to walk
// the code space.
export const wgShareCodeLookupLimiter = build(120, 60, 'wg-code-lookup'); // 120 share-code lookups / min / IP — brute-force defense
// Nested /api/wg/<code>/… routes answer differently for an unknown code and
// for a foreign WG. Only misses are counted (per signed-in account), so
// members are never throttled while code enumeration stops after a few tries.
export const wgShareCodeMissLimiter = build(20, 3600, 'wg-code-miss'); // 20 unknown/foreign share codes / hour / account
export const notifTestLimiter = build(3, 60, 'notif-test'); // 3 test notifications / min / member — anti-spam
export const reminderSendLimiter = build(10, 3600, 'reminder-send'); // 10 reminders / hour / member — global anti-spam
export const inviteMailLimiter = build(10, 3600, 'invite-mail'); // 10 invitation mails / hour / member — anti-spam
export const inviteMailAccountLimiter = build(20, 86_400, 'invite-mail-account'); // 20 invitation mails / day / account across WGs — a second member row does not reset it
export const inviteMailRecipientLimiter = build(2, 86_400, 'invite-mail-recipient'); // 2 invitation mails / day / address across all WGs — keeps one inbox from being mailed by many WGs

export const chatReadLimiter = build(120, 60, 'chat-read'); // 120 read-receipts / min / member
export const chatMessageLimiter = build(20, 60, 'chat-msg'); // 20 messages / min / member — anti-spam
export const uploadSignLimiter = build(10, 60, 'upload-sign'); // 10 upload signatures / min / member
// Bounds the storage a WG can fill per day: the per-minute bucket alone allows ~14,000 a day.
export const uploadSignDayLimiter = build(50, 86_400, 'upload-sign-day'); // 50 upload signatures / day / WG
// A single export request dumps the WG's entire dataset (expenses, chores,
// chat, announcements). The middleware's 300 reads/min per session is far too generous for
// that, so it gets its own bucket on top.
export const wgExportLimiter = build(20, 3600, 'wg-export'); // 20 exports / hour / member
// The dashboard aggregates the WG's financial state. The middleware's
// 300 reads/min per session is shared with every other GET, so the route gets
// its own per-member bucket: scraping balances stays throttled even from a
// rotating pool of IPs.
export const dashboardLimiter = build(60, 60, 'dashboard'); // 60 dashboard reads / min / member
// The expense list returns the WG's full expense history; same per-member
// bucket reasoning as the dashboard.
export const expensesReadLimiter = build(60, 60, 'expenses-read'); // 60 expense-list reads / min / member
export const unsubscribeLimiter = build(60, 60, 'unsubscribe'); // 60 mail unsubscribe calls / min / IP — mail providers share IPs
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
	const ip =
		forwardedForClientIp(req.headers) ||
		req.headers.get('cf-connecting-ip') ||
		req.headers.get('x-real-ip');
	return ip ? ipRateLimitKey(ip) : 'anonymous';
}

// A single IPv6 host usually owns a whole /64, so keying on the full address lets one client
// rotate through 2^64 buckets. IPv4 (and IPv4-mapped IPv6) keys stay as they are.
function ipRateLimitKey(ip: string): string {
	const bare = ip.replace(/^\[|\]$/g, '').split('%')[0] ?? ip;
	if (!bare.includes(':')) return bare;
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
	if (mapped?.[1]) return mapped[1];
	const [head = '', tail, ...extra] = bare.split('::');
	if (extra.length > 0) return bare;
	const headGroups = head ? head.split(':') : [];
	const tailGroups = tail ? tail.split(':') : [];
	const groups =
		tail === undefined
			? headGroups
			: [
					...headGroups,
					...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'),
					...tailGroups,
				];
	if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return bare;
	return `${groups
		.slice(0, 4)
		.map((group) => Number.parseInt(group, 16).toString(16))
		.join(':')}::/64`;
}

// The same pattern the auth layer uses to spot a Supabase session (it may be chunked as .0, .1).
const SESSION_COOKIE_NAME = /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?$/;

/**
 * Per-session key for the WG routes: a short hash of the Supabase session cookie, so flatmates on
 * one router IP (or strangers behind carrier NAT) get separate buckets. Only the hash is kept.
 * `null` without a session cookie. The cookie is not verified here, so callers must pair this
 * with an IP-level backstop (`wgReadIpBackstop`/`wgWriteIpBackstop`).
 */
export async function sessionRateLimitKey(req: {
	cookies: { getAll(): { name: string; value: string }[] };
}): Promise<string | null> {
	const session = req.cookies
		.getAll()
		.filter(({ name }) => SESSION_COOKIE_NAME.test(name))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(({ name, value }) => `${name}=${value}`)
		.join(';');
	if (!session) return null;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session));
	const hex = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
	return `session:${hex}`;
}

// Per-IP ceilings that stay on when the middleware keys by session: a forged cookie value would
// otherwise open a fresh bucket per request.
export const wgReadIpBackstop = build(1200, 60, 'wg-read-ip'); // 1200 reads / min / IP (a household behind one router)
export const wgWriteIpBackstop = build(150, 60, 'wg-write-ip'); // 150 writes / min / IP

export interface RateLimitResult {
	success: boolean;
	remaining: number;
	reset: number;
	limiterUnavailable?: boolean;
}

const FAIL_OPEN_PRODUCTION_LOG =
	'[rate-limit] Upstash Redis not configured in production — failing open';
const FAIL_CLOSED_PRODUCTION_LOG =
	'[rate-limit] Upstash Redis not configured in production — failing closed';
const OPEN_STATE_REPORT_INTERVAL_MS = 5 * 60 * 1000;
// Caps the throttle map: a caller passing request-derived `cause` text must not
// grow it without bound. Past the cap only known causes keep entries.
const MAX_TRACKED_CAUSES = 32;
const lastReportedAt = new Map<string, number>();

function trackCause(map: Map<string, number>, cause: string, value: number): boolean {
	if (!map.has(cause) && map.size >= MAX_TRACKED_CAUSES) return false;
	map.set(cause, value);
	return true;
}

/**
 * An unavailable limiter must remain visible in either fail mode. Reported at
 * most once per interval per cause and mode; never log provider errors because
 * they can contain credentials or request details.
 */
function reportUnavailable(
	cause: string,
	failMode: 'open' | 'closed',
	limiterCallFailed = false,
): void {
	const isProduction = process.env.VERCEL_ENV === 'production';
	const state = failMode === 'open' ? 'failing open' : 'failing closed';

	// An unconfigured limiter is only newsworthy in production; a limiter that
	// throws is a defect anywhere, so it is always logged.
	if (limiterCallFailed) {
		console.error(`[rate-limit] limiter call failed, ${state}`);
	} else if (isProduction) {
		console.error(failMode === 'open' ? FAIL_OPEN_PRODUCTION_LOG : FAIL_CLOSED_PRODUCTION_LOG);
	}

	if (!isProduction) return;
	const now = Date.now();
	const reportKey = `${failMode}:${cause}`;
	const previous = lastReportedAt.get(reportKey);
	if (previous !== undefined && now - previous < OPEN_STATE_REPORT_INTERVAL_MS) return;
	// Unknown causes beyond the tracking cap are logged above but never
	// captured here — without a stored timestamp they would bypass the
	// throttle and fire on every request.
	if (!trackCause(lastReportedAt, reportKey, now)) return;

	captureException(new Error(`rate-limit ${state}`), {
		area: 'rate-limit',
		cause,
	});
}

/** Test seam — the report throttle is process-global state. */
export function resetOpenStateReporting(): void {
	lastReportedAt.clear();
}

const LIMITER_UNAVAILABLE_RETRY_MS = 60_000;

function unavailableResult(): RateLimitResult {
	return {
		success: false,
		remaining: 0,
		reset: Date.now() + LIMITER_UNAVAILABLE_RETRY_MS,
		limiterUnavailable: true,
	};
}

export async function checkRateLimit(
	limiter: RateLimiter | null,
	key: string,
	failMode: 'open' | 'closed' = rateLimitFailMode(),
): Promise<RateLimitResult> {
	if (!limiter) {
		const mode = configuredButInvalid && process.env.VERCEL_ENV === 'preview' ? 'closed' : failMode;
		reportUnavailable('upstash-not-configured', mode);
		if (mode === 'closed') {
			return unavailableResult();
		}
		return { success: true, remaining: -1, reset: 0 };
	}
	try {
		const r = await limiter.limit(key);
		if (r.reason === 'timeout') throw new Error('Upstash rate-limit timed out');
		return { success: r.success, remaining: r.remaining, reset: r.reset };
	} catch {
		// A configured limiter that fails must not pass traffic on Preview either: that is where
		// a wrong token or URL should surface, before it reaches production.
		const mode = process.env.VERCEL_ENV === 'preview' ? 'closed' : failMode;
		reportUnavailable('limiter-call-failed', mode, true);
		if (mode === 'closed') {
			return unavailableResult();
		}
		return { success: true, remaining: -1, reset: 0 };
	}
}
