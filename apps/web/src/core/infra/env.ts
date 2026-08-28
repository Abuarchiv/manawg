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
 *     unprotected cron routes). Fatal in production.
 *   - `degraded` — a named feature is off, everything else works. Logged loud,
 *     never fatal, so a missing optional key can't take the whole app down.
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
	{
		feature: 'image-uploads',
		vars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET'],
		impact: 'S3 signing fails — receipt and announcement images cannot be uploaded.',
	},
] as const;

/** Production-only requirements. The database is required everywhere. */
const PRODUCTION_REQUIRED = ['CRON_SECRET', 'MEMBER_SESSION_SECRET'] as const;

function isSet(env: EnvSource, name: string): boolean {
	return (env[name] ?? '').trim().length > 0;
}

export function checkEnv(env: EnvSource): EnvCheckResult {
	const isProduction = env.VERCEL_ENV === 'production';

	const missingRequired: string[] = [];
	if (!isSet(env, 'POSTGRES_URL') && !isSet(env, 'DATABASE_URL')) {
		missingRequired.push('POSTGRES_URL');
	}
	if (isProduction) {
		for (const name of PRODUCTION_REQUIRED) {
			if (!isSet(env, name)) missingRequired.push(name);
		}
	}

	const degraded: DegradedFeature[] = [];
	for (const spec of OPTIONAL_FEATURES) {
		const missing = spec.vars.filter((name) => !isSet(env, name));
		if (missing.length > 0) {
			degraded.push({ feature: spec.feature, missing, impact: spec.impact });
		}
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
