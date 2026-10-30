/**
 * Startup environment validation.
 *
 * `checkEnv` reports a misconfiguration once at boot, so it does not surface
 * the first time a user reaches the affected feature.
 *
 * Required (`missingRequired`): the app cannot serve correctly without them.
 *   - In every environment: the database URL, `MEMBER_SESSION_SECRET` (signs
 *     calendar feed and unsubscribe links) and the Supabase URL and
 *     publishable key.
 *   - Only when `VERCEL_ENV` is `production`: `CRON_SECRET`, the Supabase
 *     service-role key, the image-storage settings and Upstash rate limiting.
 *     API routes fail closed without Upstash there, and account deletion must
 *     work in production.
 *
 * Degraded (`degraded`): a named optional feature is off. It is logged as a
 * warning and never fatal.
 *   - Without Upstash the rate limiter fails open outside production; a
 *     standalone server counts in memory per process.
 *   - Without VAPID keys no push notifications are sent.
 *   - Without the Supabase service-role key account deletion answers 503.
 *   - Without the storage settings image uploads answer 503 (reported as
 *     degraded outside production, required in production).
 *   - Without a Sentry DSN errors are only visible in the logs.
 */

type EnvSource = Record<string, string | undefined>;

interface DegradedFeature {
	feature:
		| 'rate-limiting'
		| 'push-notifications'
		| 'image-uploads'
		| 'account-deletion'
		| 'error-reporting';
	missing: string[];
	impact: string;
}

interface EnvCheckResult {
	ok: boolean;
	isProduction: boolean;
	missingRequired: string[];
	degraded: DegradedFeature[];
}

interface FeatureSpec {
	feature: DegradedFeature['feature'];
	vars: string[];
	impact: string;
}

const OPTIONAL_FEATURES: readonly FeatureSpec[] = [
	{
		feature: 'rate-limiting',
		vars: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
		impact:
			'Rate limiter fails open on Vercel previews and in development; a standalone server counts in memory per process.',
	},
	{
		feature: 'push-notifications',
		vars: ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
		impact: 'Web-Push is disabled — reminders and mentions never reach devices.',
	},
	{
		feature: 'account-deletion',
		vars: ['SUPABASE_SERVICE_ROLE_KEY'],
		impact: 'Account deletion answers 503 — the Auth user cannot be removed without it.',
	},
	{
		feature: 'error-reporting',
		vars: ['NEXT_PUBLIC_SENTRY_DSN'],
		impact: 'Sentry is off — server and client errors are only visible in function logs.',
	},
] as const;

/**
 * Production-only requirements. Account deletion is a legal obligation
 * (GDPR Art. 17), so a Production deployment that cannot delete Auth users
 * must not report itself healthy.
 */
const PRODUCTION_REQUIRED = ['CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

/**
 * Required in every environment, alongside the database. `MEMBER_SESSION_SECRET`
 * signs calendar feed URLs (`features/events/server/calendar-subscription.ts`) and
 * unsubscribe links. Without it every calendar feed fails with no
 * client-visible cause, so it has to be loud at boot the same way a missing
 * database is.
 */
const ALWAYS_REQUIRED = [
	'MEMBER_SESSION_SECRET',
	'NEXT_PUBLIC_SUPABASE_URL',
	'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
] as const;

function isSet(env: EnvSource, name: string): boolean {
	return (env[name] ?? '').trim().length > 0;
}

/**
 * Read a bounded positive-integer row limit for list endpoints.
 *
 * List routes cap how many rows one request may materialise, so the cap has to
 * stay a cap: operators can tune it per deployment, but the parsed value is
 * clamped to `[1, max]` and anything unparsable falls back to `fallback`,
 * which keeps a typo in the environment from disabling the protection.
 */
export function readListLimit(env: EnvSource, name: string, fallback: number, max: number): number {
	const raw = (env[name] ?? '').trim();
	if (raw.length === 0) return fallback;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed)) return fallback;
	return Math.min(Math.max(parsed, 1), max);
}

function isValidHttpsUrl(value: string | undefined): boolean {
	if (!value?.trim()) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
	} catch {
		return false;
	}
}

/** HTTPS, or plain HTTP on this machine (a local Docker stack at http://localhost). */
function isValidSupabaseUrl(value: string | undefined): boolean {
	if (isValidHttpsUrl(value)) return true;
	try {
		const url = new URL(value ?? '');
		return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
	} catch {
		return false;
	}
}

function privateImageStorageMissing(env: EnvSource): { missing: string[]; impact: string } {
	const missing: string[] = [];
	if (!isValidSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)) missing.push('NEXT_PUBLIC_SUPABASE_URL');
	if (!isSet(env, 'SUPABASE_SERVICE_ROLE_KEY')) missing.push('SUPABASE_SERVICE_ROLE_KEY');
	if (!isSet(env, 'SUPABASE_STORAGE_BUCKET')) missing.push('SUPABASE_STORAGE_BUCKET');
	return {
		missing,
		impact: 'Private Supabase image storage is unavailable — configure its server-only settings.',
	};
}

/**
 * The environment `checkEnv` inspects at runtime. Next inlines the literal
 * `process.env.NEXT_PUBLIC_*` reads below at build time, while a read through
 * the whole `process.env` object sees only the container environment. Spelling
 * the two public variables out keeps the report in line with what the push and
 * Sentry code actually use in a Docker image built with those build arguments.
 */
export function runtimeEnv(): EnvSource {
	return {
		...process.env,
		NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
		NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
	};
}

export function checkEnv(env: EnvSource): EnvCheckResult {
	const isProduction = env.VERCEL_ENV === 'production';
	const isFixtureE2EDbDown =
		!isProduction &&
		env.E2E_FIXTURE_MODE === 'true' &&
		env.CI === 'true' &&
		env.NEXT_PUBLIC_DB_DOWN === 'true' &&
		!isSet(env, 'POSTGRES_URL') &&
		!isSet(env, 'DATABASE_URL');

	const missingRequired: string[] = [];
	if (!isFixtureE2EDbDown && !isSet(env, 'POSTGRES_URL') && !isSet(env, 'DATABASE_URL')) {
		missingRequired.push('POSTGRES_URL');
	}
	if (!isFixtureE2EDbDown) {
		for (const name of ALWAYS_REQUIRED) {
			if (!isSet(env, name)) missingRequired.push(name);
		}
	}
	// Production-only requirements, including the image-storage variables.
	const imageStorage = privateImageStorageMissing(env);
	if (isProduction) {
		for (const name of PRODUCTION_REQUIRED) {
			if (!isSet(env, name)) missingRequired.push(name);
		}
		if (!isValidHttpsUrl(env.UPSTASH_REDIS_REST_URL)) {
			missingRequired.push('UPSTASH_REDIS_REST_URL');
		}
		if (!isSet(env, 'UPSTASH_REDIS_REST_TOKEN')) {
			missingRequired.push('UPSTASH_REDIS_REST_TOKEN');
		}
		missingRequired.push(...imageStorage.missing);
	}

	const degraded: DegradedFeature[] = [];
	for (const spec of OPTIONAL_FEATURES) {
		const missing = spec.vars.filter(
			(name) =>
				!isSet(env, name) ||
				(spec.feature === 'rate-limiting' &&
					name === 'UPSTASH_REDIS_REST_URL' &&
					!isValidHttpsUrl(env[name])),
		);
		if (missing.length > 0) {
			degraded.push({ feature: spec.feature, missing, impact: spec.impact });
		}
	}
	if (imageStorage.missing.length > 0 && !isProduction) {
		degraded.push({ feature: 'image-uploads', ...imageStorage });
	}

	return {
		ok: missingRequired.length === 0,
		isProduction,
		missingRequired,
		degraded,
	};
}

/** Human-readable multi-line report for the boot log. */
export function formatEnvReport(result: EnvCheckResult): string {
	const lines: string[] = [];
	if (result.missingRequired.length > 0) {
		lines.push(`[env] MISSING REQUIRED: ${result.missingRequired.join(', ')}`);
	}
	for (const entry of result.degraded) {
		lines.push(
			`[env] DEGRADED ${entry.feature} (unset: ${entry.missing.join(', ')}) — ${entry.impact}`,
		);
	}
	if (lines.length === 0) lines.push('[env] all variables present');
	return lines.join('\n');
}
