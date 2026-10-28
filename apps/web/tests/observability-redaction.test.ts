import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { contentSecurityPolicy } from '../src/core/infra/security-headers.ts';
import { applyEnv, withEnv } from './support/env.ts';

// The envelope test drives the browser SDK; @sentry/browser is only reachable through
// @sentry/nextjs, which pins the version the app ships.
const browserSentryPath = createRequire(import.meta.resolve('@sentry/nextjs')).resolve(
	'@sentry/browser',
);
const browserSentryModule = await import(pathToFileURL(browserSentryPath).href);
// biome-ignore lint/suspicious/noExplicitAny: serialized envelope payload, read by path
type SentryEventBody = Record<string, any>;

interface BrowserSentry {
	init(options: unknown): unknown;
	captureEvent(event: unknown): unknown;
	flush(timeout: number): Promise<boolean>;
	isInitialized(): boolean;
	close(timeout: number): Promise<boolean>;
}
const browserSentry = (browserSentryModule.default ?? browserSentryModule) as BrowserSentry;
const envelopes: Array<[unknown, Array<[{ type: string }, Record<string, unknown>]>]> = [];
// `sdk.onInit` observes (and replaces) Sentry.init for the entrypoint tests; without it the
// browser SDK initializes against a recording transport.
const sdk = { onInit: null as null | ((options: Record<string, unknown>) => void) };
mock.module('@sentry/nextjs', {
	namedExports: {
		init: (options: Record<string, unknown>) => {
			if (sdk.onInit) return sdk.onInit(options);
			return browserSentry.init({
				...options,
				transport: () => ({
					send(envelope: never) {
						envelopes.push(envelope);
						return Promise.resolve({ statusCode: 200 });
					},
					flush: () => Promise.resolve(true),
				}),
			} as never);
		},
		captureException() {},
		logger: { error() {} },
	},
});

// Loaded up front so the client entrypoint's lazy import resolves from the module cache.
const sentryWrapper = await import('../src/core/infra/sentry.ts');
const { captureException } = await import('../src/core/infra/observability.ts');

test('Sentry CSP allows only the configured HTTPS DSN origin', () => {
	withEnv({ NEXT_PUBLIC_SENTRY_DSN: 'https://public-key@o123.ingest.de.sentry.io/1' }, () => {
		const connectSource =
			contentSecurityPolicy('sentry-csp-test').match(/connect-src [^;]+/)?.[0] ?? '';
		assert.ok(connectSource.split(/\s+/).includes('https://o123.ingest.de.sentry.io'));
		assert.doesNotMatch(connectSource, /https:\/\/\*\.ingest\.de\.sentry\.io/);
		assert.doesNotMatch(connectSource, /public-key|\/1(?:\s|$)/);
	});
});

test('Sentry strips personal data and WG codes from error events', async () => {
	const { sanitizeSentryEvent, sanitizeSentryBreadcrumb } = await import(
		'../src/core/infra/sentry-privacy.ts'
	);
	const event = sanitizeSentryEvent({
		user: { id: 'member-1', email: 'alice@example.com' },
		request: {
			method: 'GET',
			url: 'https://manawg.com/wg/private-code/ausgaben?invite=secret',
			headers: { cookie: 'secret' },
			data: { amount: 200 },
		},
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
	const navigationBreadcrumb = sanitizeSentryBreadcrumb({
		category: 'navigation',
		message: 'Private household title',
		data: { from: '/wg/private-code/home?invite=secret', body: 'private' },
	});
	assert.equal(navigationBreadcrumb?.data?.from, '/wg/[redacted]/home');
	assert.equal(navigationBreadcrumb?.data?.body, undefined);
	assert.equal(navigationBreadcrumb?.message, undefined);

	const calendarUrl =
		'https://manawg.com/api/calendar/calendar-id/calendar-token?download=private#fragment';
	assert.equal(
		sanitizeSentryEvent({ request: { url: calendarUrl } }).request?.url,
		'https://manawg.com/api/calendar/[redacted]/[redacted]',
	);
	assert.equal(
		sanitizeSentryEvent({ transaction: 'GET /api/calendar/calendar-id/calendar-token?secret' })
			.transaction,
		'GET /api/calendar/[redacted]/[redacted]',
	);

	for (const path of ['/einladung/', '/api/wg/invites/']) {
		assert.equal(
			sanitizeSentryEvent({ request: { url: `https://manawg.com${path}aB3_-xYz09aB3_-xYz09kQ` } })
				.request?.url,
			`https://manawg.com${path}[redacted]`,
		);
	}

	const signedUpload = sanitizeSentryBreadcrumb({
		category: 'fetch',
		data: {
			url: 'https://bucket.s3.eu-central-1.amazonaws.com/manawg/wg-private-id/expense/private-file.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=private&X-Amz-Signature=private',
		},
	});
	assert.equal(
		signedUpload?.data?.url,
		'https://bucket.s3.eu-central-1.amazonaws.com/manawg/[redacted]/expense/[redacted]',
	);
	const signedSupabaseUpload = sanitizeSentryBreadcrumb({
		category: 'fetch',
		data: {
			url: 'https://project.supabase.co/storage/v1/object/upload/sign/private-bucket/manawg/private-wg-id/expense/private-file.jpg?token=private-upload-token',
		},
	});
	assert.equal(
		signedSupabaseUpload?.data?.url,
		'https://project.supabase.co/storage/v1/object/upload/sign/[redacted]',
	);
});

// The entrypoint loads its optional modules through a dynamic import; give it time to settle.
const flushOptionalImport = () => new Promise((resolve) => setTimeout(resolve, 30));

let clientEntryRuns = 0;
/**
 * Evaluates the client entrypoint afresh: its work happens at module load, driven by the env.
 * The env stays in place until `settled()` resolves, because the optional import reads it later.
 */
async function runInstrumentationClient(env: Record<string, string | undefined>) {
	const restore = applyEnv({ NODE_ENV: 'production', NEXT_PUBLIC_SENTRY_DSN: undefined, ...env });
	clientEntryRuns += 1;
	await import(`../src/instrumentation-client.ts?run=${clientEntryRuns}`);
	return {
		settled: async () => {
			await flushOptionalImport();
			restore();
		},
	};
}

test('instrumentation loads the Sentry chunk only when a DSN is configured', async () => {
	const calls: string[] = [];
	sdk.onInit = () => {
		calls.push('initializeSentry');
	};

	await (await runInstrumentationClient({})).settled();
	assert.deepEqual(calls, []);

	await (
		await runInstrumentationClient({
			NEXT_PUBLIC_SENTRY_DSN: 'https://public@o123.ingest.sentry.io/1',
		})
	).settled();
	assert.deepEqual(calls, ['initializeSentry']);
});

const ENVELOPE_TEST_ENV = {
	NEXT_PUBLIC_SENTRY_DSN: 'https://public@o123.ingest.sentry.io/1',
	NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'test',
	NEXT_PUBLIC_SENTRY_RELEASE: 'observability-envelope-test',
};

test('pinned Sentry SDK envelopes omit inferred IPs and automatic sessions', () =>
	withEnv(ENVELOPE_TEST_ENV, async () => {
		const browserGlobals = [
			'window',
			'document',
			'location',
			'history',
			'navigator',
			'fetch',
			'addEventListener',
			'removeEventListener',
		];
		const oldGlobals = new Map(
			browserGlobals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
		);
		const setGlobal = (key: string, value: unknown) =>
			Object.defineProperty(globalThis, key, {
				configurable: true,
				enumerable: true,
				writable: true,
				value,
			});
		const document = {
			visibilityState: 'hidden',
			hidden: true,
			referrer: '',
			getElementById: () => null,
			querySelector: () => null,
			addEventListener() {},
			removeEventListener() {},
		};
		Object.assign(globalThis, {
			addEventListener() {},
			removeEventListener() {},
			location: {
				href: 'https://manawg.com/',
				origin: 'https://manawg.com',
				hostname: 'manawg.com',
				pathname: '/',
			},
			history: { pushState() {}, replaceState() {} },
		});
		setGlobal('window', globalThis);
		setGlobal('document', document);
		setGlobal('navigator', { userAgent: 'Sentry test browser', language: 'de-DE' });
		let networkCalls = 0;
		setGlobal('fetch', () => {
			networkCalls += 1;
			throw new Error('network disabled in test');
		});

		envelopes.length = 0;
		sdk.onInit = null;
		try {
			sentryWrapper.initializeSentry();
			browserSentry.captureEvent({
				user: { id: 'private-member-id', email: 'alice@example.com' },
				message: 'private event message',
				exception: { values: [{ type: 'PrivateError', value: 'private exception body' }] },
				request: {
					method: 'GET',
					url: 'https://manawg.com/api/calendar/private-calendar-id/private-bearer-token?download=private-query',
					headers: { authorization: 'Bearer private-bearer-token', cookie: 'private-cookie' },
					data: { email: 'alice@example.com' },
				},
				contexts: {
					trace: { trace_id: 'trace-id', span_id: 'span-id', data: 'private span attributes' },
					user: { id: 'private-member-id' },
				},
				breadcrumbs: [
					{
						category: 'fetch',
						data: {
							url: 'https://bucket.s3.eu-central-1.amazonaws.com/manawg/private-wg-id/expense/private-object.jpg?X-Amz-Signature=private-signature',
						},
						message: 'private upload',
					},
					{
						category: 'fetch',
						data: {
							url: 'https://project.supabase.co/storage/v1/object/upload/sign/private-bucket/manawg/private-supabase-wg/expense/private-supabase-object.jpg?token=private-supabase-token',
						},
					},
				],
			} as never);
			await browserSentry.flush(1000);

			assert.ok(envelopes.length > 0);
			const items = envelopes.flatMap(([, envelopeItems]) => envelopeItems);
			assert.equal(
				items.some(([header]) => header.type === 'session'),
				false,
			);
			const event = items.find(([header]) => header.type === 'event')?.[1] as
				| SentryEventBody
				| undefined;
			assert.ok(event);
			assert.equal(event.sdk?.settings?.infer_ip, 'never');
			assert.deepEqual(event.request, {
				method: 'GET',
				url: 'https://manawg.com/api/calendar/[redacted]/[redacted]',
			});
			assert.deepEqual(event.contexts, { trace: { trace_id: 'trace-id', span_id: 'span-id' } });
			assert.equal(event.exception?.values?.[0]?.value, '[redacted]');
			assert.equal(
				event.breadcrumbs?.[0]?.data?.url,
				'https://bucket.s3.eu-central-1.amazonaws.com/manawg/[redacted]/expense/[redacted]',
			);
			assert.equal(
				event.breadcrumbs?.[1]?.data?.url,
				'https://project.supabase.co/storage/v1/object/upload/sign/[redacted]',
			);
			const serialized = JSON.stringify(envelopes);
			for (const secret of [
				'private-member-id',
				'alice@example.com',
				'private event message',
				'private exception body',
				'private-calendar-id',
				'private-bearer-token',
				'private-query',
				'private-cookie',
				'private-wg-id',
				'private-object.jpg',
				'private-signature',
				'private-bucket',
				'private-supabase-wg',
				'private-supabase-object.jpg',
				'private-supabase-token',
				'private span attributes',
			]) {
				assert.equal(serialized.includes(secret), false, `envelope retained ${secret}`);
			}
			assert.equal(networkCalls, 0);
		} finally {
			if (browserSentry.isInitialized()) await browserSentry.close(1000);
			for (const [key, descriptor] of oldGlobals) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		}
	}));

test('custom Error.name values are reduced to a trusted error type', () => {
	const calls: unknown[][] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => calls.push(args);
	try {
		const custom = new Error('provider payload');
		custom.name = 'privateDbPassword123';
		captureException(custom);
		captureException(new TypeError('another provider payload'));

		assert.equal(calls[0]?.[1], 'Error');
		assert.equal(calls[1]?.[1], 'TypeError');
		assert.equal(JSON.stringify(calls).includes('privateDbPassword123'), false);
	} finally {
		console.error = original;
	}
});

test('idempotency cache failures never log a push endpoint or provider error', async () => {
	const secret = 'privatePushEndpointToken123';
	const calls: string[] = [];
	const originalError = console.error;
	const originalWarn = console.warn;
	console.error = (...args: unknown[]) => calls.push(format(...args));
	console.warn = (...args: unknown[]) => calls.push(format(...args));
	mock.module('@/core/db', {
		namedExports: {
			db: {
				delete: () => {
					throw new Error(secret);
				},
			},
			idempotencyResponses: {},
		},
	});
	try {
		const { releaseClaimedResponse } = await import('../src/core/db/claimed-response.ts');
		const released = await releaseClaimedResponse(
			`push_subscribe:https://push.example/${secret}`,
			secret,
			new Date(),
		);
		assert.equal(released, false);
		assert.ok(calls.length > 0);
		assert.equal(JSON.stringify(calls).includes(secret), false);
	} finally {
		console.error = originalError;
		console.warn = originalWarn;
	}
});

test('client entrypoint does not load Sentry without a configured DSN', async () => {
	const loads: string[] = [];
	sdk.onInit = () => {
		loads.push('loaded');
	};
	await (await runInstrumentationClient({})).settled();
	assert.deepEqual(loads, []);
});

test('client entrypoint initializes Sentry once lazily and tolerates a failed optional import', async () => {
	const calls: string[] = [];
	sdk.onInit = () => {
		calls.push('initialized');
	};
	const run = await runInstrumentationClient({
		NEXT_PUBLIC_SENTRY_DSN: 'https://public-key@o123.ingest.de.sentry.io/1',
	});
	assert.deepEqual(calls, []);
	await run.settled();
	assert.deepEqual(calls, ['initialized']);

	const failedLoads: string[] = [];
	sdk.onInit = () => {
		failedLoads.push('loaded');
		throw new Error('optional Sentry unavailable');
	};
	const failedRun = await runInstrumentationClient({ NEXT_PUBLIC_SENTRY_DSN: 'configured' });
	assert.deepEqual(failedLoads, []);
	await failedRun.settled();
	assert.deepEqual(failedLoads, ['loaded']);
});

test('Vercel config loads the public Sentry config wrapper', async () => {
	const nextConfig = await withEnv(
		{
			VERCEL: '1',
			VERCEL_ENV: 'preview',
			NODE_ENV: 'production',
			SENTRY_ORG: 'fixture-org',
			SENTRY_PROJECT: 'fixture-project',
			SENTRY_AUTH_TOKEN: 'fixture-only-not-a-credential',
		},
		() => import('../next.config.ts'),
	);
	assert.equal(typeof nextConfig.default?.headers, 'function');
});

// Reads the error boundary components themselves (non-executable here): each must declare a
// boundary tag that the Sentry tag filter keeps.
test('every route error boundary tag survives Sentry tag filtering', async () => {
	const { SAFE_TAG_VALUES } = await import('../src/core/infra/sentry-privacy.ts');
	const appDir = fileURLToPath(new URL('../src/app', import.meta.url));
	const boundaryFiles = readdirSync(appDir, { recursive: true }).filter((file) =>
		/(^|[/\\])(global-)?error\.tsx$/.test(String(file)),
	);
	assert.ok(boundaryFiles.length > 0);
	for (const file of boundaryFiles) {
		const source = readFileSync(path.join(appDir, String(file)), 'utf8');
		const tag = source.match(/boundary(?:="|: ')([a-z-]+)/)?.[1];
		assert.ok(tag, `${file} has no boundary tag`);
		assert.ok(SAFE_TAG_VALUES.boundary?.has(tag), `${file}: boundary "${tag}" is not allowed`);
	}
});
