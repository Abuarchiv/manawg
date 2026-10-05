/**
 * Client-side entry to `captureException`. Loads the Sentry-backed reporter
 * only when an error actually happens, so the Sentry SDK stays out of every
 * page's first-load JavaScript. Server code imports `./observability` directly.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
	void import('./observability')
		.then((m) => m.captureException(err, context))
		.catch(() => {
			// Reporting must never break the caller.
		});
}
