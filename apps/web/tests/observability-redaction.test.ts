import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import { mockDb } from './support/db-mock';

// Server-side redaction: the CSP's Sentry origin, the event and breadcrumb sanitizers, and the
// error log, which runs for real with only the Sentry transport replaced.

const sentryCalls: { tags: Record<string, string> }[] = [];
const releaseFailure = { error: new Error('unset') };

mock.module('@/core/infra/sentry', {
	namedExports: {
		captureSentryException: (_error: unknown, tags: Record<string, string>) => {
			sentryCalls.push({ tags });
		},
		logSentryApiError: () => undefined,
		initializeSentry: () => undefined,
	},
});
mockDb({
	db: {
		delete: () => {
			throw releaseFailure.error;
		},
	},
});

const { contentSecurityPolicy } = await import('../src/core/infra/security-headers.ts');
const { sanitizeSentryBreadcrumb, sanitizeSentryEvent } = await import(
	'../src/core/infra/sentry-privacy.ts'
);
const { captureException } = await import('../src/core/infra/observability.ts');
const { releaseClaimedResponse } = await import('../src/core/db/claimed-response.ts');

test('Sentry CSP allows only the configured HTTPS DSN origin', () => {
	const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
	process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public-key@o123.ingest.de.sentry.io/1';
	try {
		const connectSource =
			contentSecurityPolicy('sentry-csp-test').match(/connect-src [^;]+/)?.[0] ?? '';
		assert.ok(connectSource.split(/\s+/).includes('https://o123.ingest.de.sentry.io'));
		assert.doesNotMatch(connectSource, /https:\/\/\*\.ingest\.de\.sentry\.io/);
		assert.doesNotMatch(connectSource, /public-key|\/1(?:\s|$)/);
	} finally {
		if (originalDsn === undefined) Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_SENTRY_DSN');
		else process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
	}
});

interface SentryEvent {
	user?: unknown;
	request?: { url?: string; method?: string };
	message?: unknown;
	exception?: { values?: { type?: string; value?: string }[] };
	extra?: unknown;
	contexts?: unknown;
	tags?: Record<string, string>;
	transaction?: string;
}
interface Breadcrumb {
	message?: string;
	data?: Record<string, unknown>;
}

test('Sentry strips personal data and WG codes from error events', () => {
	const event = sanitizeSentryEvent<SentryEvent>({
		user: { id: 'member-1', email: 'alice@example.com' },
		request: {
			method: 'GET',
			url: 'https://manawg.com/wg/private-code/ausgaben?invite=secret',
			headers: { cookie: 'secret' },
			data: { amount: 200 },
		} as SentryEvent['request'],
		message: 'alice@example.com',
		exception: { values: [{ type: 'Private-group-code', value: 'expense for Alice' }] },
		extra: { name: 'Alice' },
		contexts: {
			trace: { trace_id: 'trace-id', span_id: 'span-id', data: 'member-email@example.com' },
			user: { id: 'member-1' },
		},
		tags: { boundary: 'root', memberId: 'private-code' },
		transaction: 'GET /wg/private-code/ausgaben?tab=all',
	});

	assert.equal(event.user, undefined);
	assert.deepEqual(event.request, {
		method: 'GET',
		url: 'https://manawg.com/wg/[redacted]/ausgaben',
	});
	assert.equal(event.message, undefined);
	assert.equal(event.exception?.values?.[0]?.value, '[redacted]');
	assert.equal(event.exception?.values?.[0]?.type, 'Error');
	assert.equal(event.extra, undefined);
	assert.deepEqual(event.contexts, {
		trace: { trace_id: 'trace-id', span_id: 'span-id' },
	});
	assert.deepEqual(event.tags, { boundary: 'root' });
	assert.equal(event.transaction, 'GET /wg/[redacted]/ausgaben');
	assert.equal(sanitizeSentryBreadcrumb({ category: 'ui', message: 'clicked Alice' }), null);
	const navigationBreadcrumb = sanitizeSentryBreadcrumb<Breadcrumb>({
		category: 'navigation',
		message: 'Private household title',
		data: { from: '/wg/private-code/home?invite=secret', body: 'private' },
	} as Breadcrumb);
	assert.equal(navigationBreadcrumb?.data?.from, '/wg/[redacted]/home');
	assert.equal(navigationBreadcrumb?.data?.body, undefined);
	assert.equal(navigationBreadcrumb?.message, undefined);

	const calendarUrl =
		'https://manawg.com/api/calendar/calendar-id/calendar-token?download=private#fragment';
	assert.equal(
		sanitizeSentryEvent<SentryEvent>({ request: { url: calendarUrl } }).request?.url,
		'https://manawg.com/api/calendar/[redacted]/[redacted]',
	);
	assert.equal(
		sanitizeSentryEvent<SentryEvent>({
			transaction: 'GET /api/calendar/calendar-id/calendar-token?secret',
		}).transaction,
		'GET /api/calendar/[redacted]/[redacted]',
	);

	const signedUpload = sanitizeSentryBreadcrumb<Breadcrumb>({
		category: 'fetch',
		data: {
			url: 'https://bucket.s3.eu-central-1.amazonaws.com/manawg/wg-private-id/expense/private-file.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=private&X-Amz-Signature=private',
		},
	} as Breadcrumb);
	assert.equal(
		signedUpload?.data?.url,
		'https://bucket.s3.eu-central-1.amazonaws.com/manawg/[redacted]/expense/[redacted]',
	);
	const signedSupabaseUpload = sanitizeSentryBreadcrumb<Breadcrumb>({
		category: 'fetch',
		data: {
			url: 'https://project.supabase.co/storage/v1/object/upload/sign/private-bucket/manawg/private-wg-id/expense/private-file.jpg?token=private-upload-token',
		},
	} as Breadcrumb);
	assert.equal(
		signedSupabaseUpload?.data?.url,
		'https://project.supabase.co/storage/v1/object/upload/sign/[redacted]',
	);
});

test('custom Error.name values are reduced to a trusted error type', (t) => {
	const calls: unknown[][] = [];
	t.mock.method(console, 'error', (...args: unknown[]) => calls.push(args));
	const custom = new Error('provider payload');
	custom.name = 'privateDbPassword123';
	captureException(custom);
	captureException(new TypeError('another provider payload'));

	assert.equal(calls[0]?.[1], 'Error');
	assert.equal(calls[1]?.[1], 'TypeError');
	assert.equal(JSON.stringify(calls).includes('privateDbPassword123'), false);
});

test('idempotency cache failures never log a push endpoint or provider error', async (t) => {
	const secret = 'privatePushEndpointToken123';
	const calls: string[] = [];
	t.mock.method(console, 'error', (...args: unknown[]) => calls.push(format(...args)));
	t.mock.method(console, 'warn', (...args: unknown[]) => calls.push(format(...args)));
	releaseFailure.error = new Error(secret);
	const released = await releaseClaimedResponse(
		`push_subscribe:https://push.example/${secret}`,
		secret,
		new Date(),
	);
	assert.equal(released, false);
	assert.ok(calls.length > 0);
	assert.equal(JSON.stringify(calls).includes(secret), false);
});

test('Vercel config loads the public Sentry config wrapper', async () => {
	const env = {
		VERCEL: '1',
		VERCEL_ENV: 'preview',
		NODE_ENV: 'production',
		SENTRY_ORG: 'fixture-org',
		SENTRY_PROJECT: 'fixture-project',
		SENTRY_AUTH_TOKEN: 'fixture-only-not-a-credential',
	};
	const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
	Object.assign(process.env, env);
	try {
		const { default: config } = await import('../next.config.ts');
		assert.equal(typeof config.headers, 'function');
	} finally {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
	}
});

/**
 * The boundary tag of every route `error.tsx`. JSX modules cannot be loaded by the test runner
 * (Node strips types, not JSX), so the tag literal is read from the source.
 */
function routeBoundaryTags(): { file: string; tag: string | undefined }[] {
	const appDir = fileURLToPath(new URL('../src/app', import.meta.url));
	return readdirSync(appDir, { recursive: true })
		.map(String)
		.filter((file) => /(^|[/\\])(global-)?error\.tsx$/.test(file))
		.map((file) => ({
			file,
			tag: readFileSync(path.join(appDir, file), 'utf8').match(/boundary(?:="|: ')([a-z-]+)/)?.[1],
		}));
}

test('every route error boundary tag survives Sentry tag filtering', (t) => {
	t.mock.method(console, 'error', () => undefined);
	const boundaries = routeBoundaryTags();
	assert.ok(boundaries.length > 0);
	for (const { file, tag } of boundaries) {
		assert.ok(tag, `${file} has no boundary tag`);
		sentryCalls.length = 0;
		captureException(new Error('boundary'), { boundary: tag });
		assert.deepEqual(
			sentryCalls.map((call) => call.tags),
			[{ boundary: tag }],
			`${file}: boundary "${tag}" is not allowed`,
		);
		const event = sanitizeSentryEvent<SentryEvent>({ tags: { boundary: tag } });
		assert.deepEqual(event.tags, { boundary: tag });
	}
});
