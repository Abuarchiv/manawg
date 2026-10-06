import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';

// The real Sentry setup on the pinned browser SDK, with a transport that keeps every envelope in
// memory instead of sending it.

const require = createRequire(import.meta.url);
const sentryRequire = createRequire(require.resolve('@sentry/nextjs/package.json'));
/** The part of the browser SDK this test drives. */
interface BrowserSentry {
	init(options: Record<string, unknown>): unknown;
	captureEvent(event: Record<string, unknown>): string;
	flush(timeout: number): Promise<boolean>;
	close(timeout: number): Promise<boolean>;
	isInitialized(): boolean;
}
const browserSentry = sentryRequire('@sentry/browser') as BrowserSentry;

type Envelope = [unknown, [{ type?: string }, unknown][]];
const envelopes: Envelope[] = [];

mock.module('@sentry/nextjs', {
	namedExports: {
		...browserSentry,
		init(options: Record<string, unknown>) {
			return browserSentry.init({
				...options,
				transport: () => ({
					send(envelope: unknown) {
						envelopes.push(envelope as Envelope);
						return Promise.resolve({ statusCode: 200 });
					},
					flush: () => Promise.resolve(true),
				}),
			});
		},
	},
});

const { initializeSentry } = await import('../src/core/infra/sentry.ts');

interface CapturedEvent {
	sdk?: { settings?: { infer_ip?: string } };
	request?: unknown;
	contexts?: unknown;
	exception?: { values?: { value?: string }[] };
	breadcrumbs?: { data?: { url?: string } }[];
}

function installBrowserGlobals(): { networkCalls: () => number; restore: () => void } {
	const names = [
		'window',
		'document',
		'location',
		'history',
		'navigator',
		'fetch',
		'addEventListener',
		'removeEventListener',
	];
	const previous = new Map(names.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	const setGlobal = (key: string, value: unknown) =>
		Object.defineProperty(globalThis, key, {
			configurable: true,
			enumerable: true,
			writable: true,
			value,
		});
	setGlobal('addEventListener', () => undefined);
	setGlobal('removeEventListener', () => undefined);
	setGlobal('location', {
		href: 'https://manawg.com/',
		origin: 'https://manawg.com',
		hostname: 'manawg.com',
		pathname: '/',
	});
	setGlobal('history', { pushState() {}, replaceState() {} });
	setGlobal('window', globalThis);
	setGlobal('document', {
		visibilityState: 'hidden',
		hidden: true,
		referrer: '',
		getElementById: () => null,
		querySelector: () => null,
		addEventListener() {},
		removeEventListener() {},
	});
	setGlobal('navigator', { userAgent: 'Sentry test browser', language: 'de-DE' });
	let networkCalls = 0;
	setGlobal('fetch', () => {
		networkCalls += 1;
		throw new Error('network disabled in test');
	});
	return {
		networkCalls: () => networkCalls,
		restore: () => {
			for (const [key, descriptor] of previous) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
	};
}

test('pinned Sentry SDK envelopes omit inferred IPs and automatic sessions', async (t) => {
	const env = {
		NEXT_PUBLIC_SENTRY_DSN: 'https://public@o123.ingest.sentry.io/1',
		NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'test',
		NEXT_PUBLIC_SENTRY_RELEASE: 'observability-envelope-test',
	};
	const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
	Object.assign(process.env, env);
	const browser = installBrowserGlobals();
	t.after(async () => {
		if (browserSentry.isInitialized()) await browserSentry.close(1000);
		browser.restore();
		for (const [key, value] of Object.entries(previousEnv)) {
			if (value === undefined) Reflect.deleteProperty(process.env, key);
			else process.env[key] = value;
		}
	});

	initializeSentry();
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
	});
	await browserSentry.flush(1000);

	assert.ok(envelopes.length > 0);
	const items = envelopes.flatMap(([, envelopeItems]) => envelopeItems);
	assert.equal(
		items.some(([header]) => header.type === 'session'),
		false,
	);
	const event = items.find(([header]) => header.type === 'event')?.[1] as CapturedEvent | undefined;
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
	assert.equal(browser.networkCalls(), 0);
});
