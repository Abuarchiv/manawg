import 'server-only';
import { captureCheckIn, flush } from '@sentry/nextjs';

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
		checkInId = captureCheckIn(
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
			captureCheckIn({ checkInId, monitorSlug: slug, status });
			// The function may freeze right after responding; send the check-in first.
			await flush(2000);
		} catch {
			// Optional telemetry must never break the job.
		}
	}
}
