import * as Sentry from '@sentry/nextjs';
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from './sentry-privacy';

type Integration = { name: string };

// Release health (sessions) is not collected; the privacy policy promises no session data.
const SESSION_INTEGRATIONS = new Set(['BrowserSession', 'ProcessSession']);

/** `overrides` replace the default integration with the same name. */
export function initializeSentry(overrides: Integration[] = []): void {
	const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
	if (!dsn) return;

	try {
		Sentry.init({
			dsn,
			environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
			release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
			dataCollection: { userInfo: false },
			integrations: (integrations) =>
				integrations
					.filter(
						({ name }) =>
							!SESSION_INTEGRATIONS.has(name) && !overrides.some((o) => o.name === name),
					)
					.concat(overrides as typeof integrations),
			beforeSend: sanitizeSentryEvent,
			beforeBreadcrumb: sanitizeSentryBreadcrumb,
		});
	} catch {
		// Optional telemetry must never prevent the app from starting.
	}
}

export function captureSentryException(error: unknown, tags: Record<string, string>): void {
	try {
		Sentry.captureException(error, { tags });
	} catch {
		// Optional telemetry must never break the caller.
	}
}

export function logSentryApiError(errorTypes: string[]): void {
	try {
		Sentry.logger.error('api_route_error', {
			error_types: errorTypes.join(' | '),
		});
	} catch {
		// Optional telemetry must never break the caller.
	}
}

/**
 * Reports a cron run to Sentry Crons, so a run that never starts or is killed by the function
 * timeout raises an alert; thrown errors alone cannot show either. Vercel starts daily crons
 * somewhere within the scheduled hour, hence the wide margin. A response other than 2xx counts
 * as a failed run.
 */
export async function monitorCron<R extends Response>(
	slug: string,
	schedule: string,
	run: () => Promise<R>,
): Promise<R> {
	let checkInId: string | undefined;
	try {
		checkInId = Sentry.captureCheckIn(
			{ monitorSlug: slug, status: 'in_progress' },
			{
				schedule: { type: 'crontab', value: schedule },
				checkinMargin: 90,
				maxRuntime: 15,
				timezone: 'UTC',
			},
		);
	} catch {
		// Optional telemetry must never break the job.
	}
	let status: 'ok' | 'error' = 'error';
	try {
		const response = await run();
		if (response.ok) status = 'ok';
		return response;
	} finally {
		try {
			Sentry.captureCheckIn({ checkInId, monitorSlug: slug, status });
			// The function may freeze right after responding; send the check-in first.
			await Sentry.flush(2000);
		} catch {
			// Optional telemetry must never break the job.
		}
	}
}
