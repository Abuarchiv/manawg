/**
 * Error reporting.
 *
 * Errors go to the platform log (`console.error`), which Vercel captures and
 * retains per its log-retention window. There is no third-party error tracker:
 * nothing is shipped off-platform, which keeps the data-processing surface of
 * the app limited to the host itself.
 *
 * Deliberately best-effort: reporting an error must never itself throw and
 * never change control flow at the call site.
 */

/**
 * Report an unexpected error, optionally with structured context.
 *
 * `context` is serialised alongside the error so the log line carries the
 * information needed to place it (route, boundary, monitor slug, ...).
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
	try {
		if (context) {
			console.error('[error]', err, context);
			return;
		}
		console.error('[error]', err);
	} catch {
		// Logging must never break the caller.
	}
}

/**
 * Wrap a cron handler so a thrown error is logged with its job name before it
 * propagates. Without this, a crashing cron job surfaces only as an opaque 500
 * with no indication of which job failed.
 *
 * The error is rethrown so the framework still returns 500 — this only adds
 * visibility, it never swallows the failure.
 */
export function withCronLogging<T extends (...args: never[]) => Promise<unknown>>(
	jobName: string,
	handler: T,
): T {
	return (async (...args: Parameters<T>): Promise<unknown> => {
		try {
			return await handler(...args);
		} catch (err) {
			captureException(err, { cronJob: jobName });
			throw err;
		}
	}) as T;
}
