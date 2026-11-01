// zod probes `new Function` to speed up parsing; the CSP forbids eval, so the probe would be
// reported as a violation on every page. zod reads this shared object, so setting it here,
// before any app code parses, needs no import.
const zodGlobal = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
zodGlobal.__zod_globalConfig ??= {};
zodGlobal.__zod_globalConfig.jitless = true;

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
	import('@/core/infra/sentry')
		.then(({ initializeSentry }) => initializeSentry())
		.catch(() => {
			// Optional telemetry must never prevent the app from starting.
		});
}

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

/**
 * Analytics is not needed for the first paint: the ~90 kB SDK loads in idle time so it does
 * not compete with the page's own chunks on slow mobile connections.
 */
function whenIdle(task: () => void): void {
	if (typeof window.requestIdleCallback === 'function') {
		window.requestIdleCallback(task, { timeout: 5000 });
	} else if (typeof window.setTimeout === 'function') {
		window.setTimeout(task, 2000);
	} else {
		// Minimal window stubs (the analytics privacy check) run the init straight away.
		task();
	}
}

/**
 * The page path with WG codes and invite tokens replaced by their route parameter, so page
 * views show which screens are used without carrying anything that identifies a household.
 * Paths outside the plain lowercase route charset (for example a mistyped URL) collapse to one value.
 */
function routeTemplate(pathname: string): string {
	const template = pathname
		.replace(/^\/wg\/[^/]+/, '/wg/[code]')
		.replace(/^\/invite\/[^/]+/, '/invite/[token]');
	return /^(\/([a-z0-9-]+|\[code\]|\[token\])){0,4}\/?$/.test(template) ? template : '/[other]';
}

/**
 * Local builds (e2e, `next start`), preview deployments and automated browsers (prod smoke runs,
 * QA matrices, Lighthouse; they set navigator.webdriver) must not count as real usage.
 */
function isTestDeployment(): boolean {
	return (
		process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === 'preview' ||
		['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) ||
		navigator.webdriver === true
	);
}

function loadAnalytics(key: string, host: string): void {
	import('posthog-js')
		.then(({ default: posthog }) => {
			posthog.init(key, {
				api_host: host,
				defaults: '2026-08-30',
				cookieless_mode: 'always',
				persistence: 'memory',
				person_profiles: 'never',
				autocapture: false,
				disable_session_recording: true,
				disable_surveys: true,
				advanced_disable_flags: true,
				capture_exceptions: false,
				capture_pageleave: false,
				capture_pageview: 'history_change',
				before_send(event) {
					if (
						!event ||
						!['$pageview', 'wg_created', 'wg_joined'].includes(event.event) ||
						typeof event.uuid !== 'string' ||
						!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.uuid)
					)
						return null;
					const time = event.timestamp instanceof Date ? event.timestamp.getTime() : Number.NaN;
					if (!Number.isFinite(time)) return null;
					// Rebuild instead of forwarding SDK URL/title/identity enrichment or caller properties.
					return {
						uuid: event.uuid,
						event: event.event,
						timestamp: new Date(time),
						properties: {
							token: key,
							distinct_id: '$posthog_cookieless',
							$cookieless_mode: true,
							$process_person_profile: false,
							$host: window.location.hostname,
							$pathname: routeTemplate(window.location.pathname),
							$raw_user_agent: navigator.userAgent,
						},
					};
				},
				debug: process.env.NODE_ENV === 'development',
			});
		})
		.catch(() => {
			console.warn('[manawg] Analytics initialization unavailable');
		});
}

if (key && host === 'https://eu.i.posthog.com' && !isTestDeployment()) {
	whenIdle(() => loadAnalytics(key, host));
} else if (process.env.NODE_ENV === 'development') {
	for (const variable of [
		...(key ? [] : ['NEXT_PUBLIC_POSTHOG_KEY']),
		...(host ? [] : ['NEXT_PUBLIC_POSTHOG_HOST']),
	]) {
		console.error(
			`${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`,
		);
	}
}
