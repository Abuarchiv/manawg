import { isOfficialInstance } from '@/shared/lib/landing-url';

/** Comma-separated `STATEMENT_EMAIL_ALLOWLIST`, lower-cased; `null` when unset. */
export function readAllowlist(
	env: Readonly<Record<string, string | undefined>> = process.env,
): Set<string> | null {
	const entries = (env.STATEMENT_EMAIL_ALLOWLIST ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	return entries.length > 0 ? new Set(entries) : null;
}

/** Whether a configured transport can send, including development and fixture dry runs. */
export function mailAvailable(
	env: Readonly<Record<string, string | undefined>> = {
		...process.env,
		NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
	},
): boolean {
	if (
		env.NODE_ENV !== 'production' ||
		(env.E2E_FIXTURE_MODE === 'true' && env.VERCEL_ENV !== 'production')
	)
		return true;
	const hasSender =
		Boolean(env.STATEMENT_EMAIL_FROM?.trim()) || isOfficialInstance(env.NEXT_PUBLIC_APP_URL);
	return (
		hasSender &&
		(Boolean(env.SMTP_HOST?.trim()) ||
			(Boolean(env.RESEND_API_KEY?.trim()) &&
				(env.VERCEL_ENV === 'production' || readAllowlist(env) !== null)))
	);
}
