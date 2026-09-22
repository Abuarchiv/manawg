/**
 * Startup environment validation.
 *
 * The app degrades silently when optional infrastructure is unconfigured:
 * without Upstash the rate limiter fails open, without VAPID keys push
 * notifications never send, without AWS credentials image uploads 500 on the
 * first signature request. In production those are invisible until a user
 * hits them. `checkEnv` turns that into one explicit report at boot.
 *
 * Split into two severities:
 *   - `missingRequired` — the app cannot serve correctly at all (no database,
 *     no signed member sessions so every write is rejected, unprotected cron
 *     routes). The database and member-session secret are checked in every
 *     environment; unprotected cron routes are only fatal in production.
 *   - `degraded` — a named non-critical feature is off. Logged loud, never
 *     fatal; production rate limiting is required because API routes fail closed.
 */

type EnvSource = Record<string, string | undefined>;

interface DegradedFeature {
	feature: 'rate-limiting' | 'push-notifications' | 'image-uploads' | 'error-reporting';
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

const AWS_IMAGE_VARS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET'];

const OPTIONAL_FEATURES: readonly FeatureSpec[] = [
	{
		feature: 'rate-limiting',
		vars: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
		impact: 'Rate limiter fails open — every endpoint is unthrottled.',
	},
	{
		feature: 'push-notifications',
		vars: ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
		impact: 'Web-Push is disabled — reminders and mentions never reach devices.',
	},
] as const;

/** Production-only requirements. */
const PRODUCTION_REQUIRED = ['CRON_SECRET'] as const;

/**
 * Required in every environment, alongside the database. Unlike the
 * production-only list above, going without `MEMBER_SESSION_SECRET` doesn't
 * degrade a named feature — every member token derives to `null`
 * (`deriveMemberToken`), so `requireMember` rejects every mutating request
 * with `member_not_verified` (`src/core/guards/api-auth.ts`). That's a
 * server-side 403 on every write with no client-visible cause, so it has to
 * be loud at boot the same way a missing database is.
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
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}

function privateImageStorageMissing(env: EnvSource): { missing: string[]; impact: string } {
	const provider = env.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase() || 'aws';
	if (provider === 'aws') {
		return {
			missing: AWS_IMAGE_VARS.filter((name) => !isSet(env, name)),
			impact: 'S3 signing fails — receipt and announcement images cannot be uploaded.',
		};
	}
	if (provider === 'supabase') {
		const missing: string[] = [];
		if (!isValidHttpsUrl(env.NEXT_PUBLIC_SUPABASE_URL)) missing.push('NEXT_PUBLIC_SUPABASE_URL');
		if (!isSet(env, 'SUPABASE_SERVICE_ROLE_KEY')) missing.push('SUPABASE_SERVICE_ROLE_KEY');
		if (!isSet(env, 'SUPABASE_STORAGE_BUCKET')) missing.push('SUPABASE_STORAGE_BUCKET');
		return {
			missing,
			impact: 'Private Supabase image storage is unavailable — configure its server-only settings.',
		};
	}
	return {
		missing: ['IMAGE_STORAGE_PROVIDER'],
		impact: 'Image uploads are disabled — IMAGE_STORAGE_PROVIDER must be aws or supabase.',
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
	const imageStorage = privateImageStorageMissing(env);
	if (imageStorage.missing.length > 0) {
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
