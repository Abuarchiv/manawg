/**
 * This file has to live in `src/`, not in the package root.
 *
 * Next.js looks for `instrumentation.ts` next to the app directory — and this
 * app lives in `src/app`. In the package root the file is silently ignored: no
 * build artifact, no error, no boot log.
 */

/**
 * Surfaces configuration problems once at boot instead of letting each affected
 * feature fail silently at the moment a user first touches it.
 */
async function reportEnvironment(): Promise<void> {
	const { checkEnv, formatEnvReport, runtimeEnv } = await import('./core/infra/env');
	const result = checkEnv(runtimeEnv());
	const report = formatEnvReport(result);

	if (!result.ok) {
		const { captureException } = await import('./core/infra/observability');
		const error = new Error(
			`Missing required environment variables: ${result.missingRequired.join(', ')}`,
		);
		captureException(error, {
			area: 'startup',
			missing: result.missingRequired,
			report,
		});
		// Do not crash boot: a missing variable only degrades the affected feature.
		console.error(report);
		return;
	}
	// biome-ignore lint/suspicious/noConsole: degraded startup diagnostics are informational.
	if (result.degraded.length > 0) console.info(report);
}

export async function register() {
	if (process.env.NEXT_RUNTIME === 'nodejs') {
		await import('../sentry.server.config');
		await reportEnvironment();
	} else if (process.env.NEXT_RUNTIME === 'edge') {
		await import('../sentry.edge.config');
	}
}

/**
 * Next.js calls this for every server-side error, including ones thrown during
 * rendering that never reach a route's own catch block. Without it those
 * failures would only show up as an opaque 500 in the platform log.
 *
 * `request.path` holds concrete segments such as invite codes, so only the
 * route template from `context.routePath` (for example `/wg/[code]/expenses`)
 * is reported.
 */
export async function onRequestError(
	error: unknown,
	request: { path: string; method: string },
	context?: { routePath?: string },
): Promise<void> {
	const { captureException } = await import('./core/infra/observability');
	captureException(error, { method: request.method, routePath: context?.routePath });
}
