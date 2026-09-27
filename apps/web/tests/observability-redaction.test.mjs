import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import { contentSecurityPolicy } from '../src/shared/lib/security-headers.ts';

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
});

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sourcePath = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'../src/core/infra/observability.ts',
);
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
	(name) => {
		if (name === './sentry') return { captureSentryException() {}, logSentryApiError() {} };
		if (name === './sentry-privacy') return loadCoreModule('sentry-privacy.ts', {});
		return require(name);
	},
	loaded,
	loaded.exports,
);
const { captureException } = loaded.exports;

function loadCoreModule(relativePath, overrides) {
	const source = readFileSync(path.join(path.dirname(sourcePath), relativePath), 'utf8');
	const code = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', code)(
		(name) => (name in overrides ? overrides[name] : require(name)),
		module,
		module.exports,
	);
	return module.exports;
}

test('custom Error.name values are reduced to a trusted error type', () => {
	const calls = [];
	const original = console.error;
	console.error = (...args) => calls.push(args);
	try {
		const custom = new Error('provider payload');
		custom.name = 'privateDbPassword123';
		captureException(custom);
		captureException(new TypeError('another provider payload'));

		assert.equal(calls[0][1], 'Error');
		assert.equal(calls[1][1], 'TypeError');
		assert.equal(JSON.stringify(calls).includes('privateDbPassword123'), false);
	} finally {
		console.error = original;
	}
});

test('idempotency cache failures never log a push endpoint or provider error', async () => {
	const secret = 'privatePushEndpointToken123';
	const calls = [];
	const originalError = console.error;
	const originalWarn = console.warn;
	console.error = (...args) => calls.push(format(...args));
	console.warn = (...args) => calls.push(format(...args));
	try {
		const { setCachedResponse } = loadCoreModule('../idempotency.ts', {
			'@/core/db': {
				db: {
					update: () => {
						throw new Error(secret);
					},
				},
				idempotencyResponses: {},
			},
			'@/core/guards/api-auth': { UUID_PATTERN: /^[0-9a-f-]+$/i },
			'@/core/infra/observability': loaded.exports,
			'@/core/rate-limit': { createConfiguredRedis: () => null },
		});
		await setCachedResponse(`push_subscribe:https://push.example/${secret}`, secret, {
			body: 'x'.repeat(33_000),
		});
		assert.ok(calls.length > 0);
		assert.equal(JSON.stringify(calls).includes(secret), false);
	} finally {
		console.error = originalError;
		console.warn = originalWarn;
	}
});

const clientEntryPath = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'../src/instrumentation-client.ts',
);

function runInstrumentationClient(env, loadSentry) {
	const source = ts.transpileModule(readFileSync(clientEntryPath, 'utf8'), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'process', source)(
		(name) => {
			if (name === '@/core/infra/sentry') return loadSentry();
			throw new Error(`Unexpected optional import: ${name}`);
		},
		module,
		module.exports,
		{ env },
	);
}

const flushOptionalImport = () => new Promise((resolve) => setImmediate(resolve));

test('client entrypoint does not load Sentry without a configured DSN', async () => {
	const loads = [];
	runInstrumentationClient({}, () => loads.push('loaded'));
	await flushOptionalImport();
	assert.deepEqual(loads, []);
});

test('client entrypoint initializes Sentry once lazily and tolerates a failed optional import', async () => {
	const calls = [];
	runInstrumentationClient(
		{ NEXT_PUBLIC_SENTRY_DSN: 'https://public-key@o123.ingest.de.sentry.io/1' },
		() => {
			calls.push('loaded');
			return { initializeSentry: () => calls.push('initialized') };
		},
	);
	assert.deepEqual(calls, []);
	await flushOptionalImport();
	assert.deepEqual(calls, ['loaded', 'initialized']);

	const failedLoads = [];
	runInstrumentationClient({ NEXT_PUBLIC_SENTRY_DSN: 'configured' }, () => {
		failedLoads.push('loaded');
		throw new Error('optional Sentry unavailable');
	});
	assert.deepEqual(failedLoads, []);
	await flushOptionalImport();
	assert.deepEqual(failedLoads, ['loaded']);
});

test('Vercel config loads the public Sentry config wrapper', () => {
	const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../next.config.ts');
	const source = readFileSync(configPath, 'utf8');
	const compiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	}).outputText;
	const module = { exports: {} };
	const env = {
		VERCEL: '1',
		VERCEL_ENV: 'preview',
		NODE_ENV: 'production',
		SENTRY_ORG: 'fixture-org',
		SENTRY_PROJECT: 'fixture-project',
		SENTRY_AUTH_TOKEN: 'fixture-only-not-a-credential',
	};
	new Function('require', 'module', 'exports', 'process', compiled)(
		require,
		module,
		module.exports,
		{ env },
	);
	assert.equal(typeof module.exports.default?.headers, 'function');
});
