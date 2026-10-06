import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The real client entrypoint, evaluated once per scenario, with a fresh stand-in for the
// Sentry chunk it loads on demand.

let run = 0;
const entrypoint = new URL('../src/instrumentation-client.ts', import.meta.url);
// The entrypoint has no ESM syntax, so Node evaluates it as CommonJS and caches it by file
// name; dropping the cache entry lets each scenario evaluate it again.
const requireCache = createRequire(import.meta.url).cache;

interface Scenario {
	/** Called when the loaded chunk is used; throwing stands in for a broken chunk. */
	onImport?: () => void;
	onInitialize: () => void;
}

/** Evaluate the entrypoint with `env` and wait briefly for the optional chunk to load. */
async function runEntrypoint(
	env: Record<string, string>,
	scenario: Scenario,
	wait: { done?: () => boolean; checkSync?: () => void } = {},
): Promise<void> {
	const sentry = mock.module('@/core/infra/sentry', {
		namedExports: {
			initializeSentry: () => {
				scenario.onImport?.();
				scenario.onInitialize();
			},
		},
	});
	const names = ['NEXT_PUBLIC_SENTRY_DSN', 'NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST'];
	const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	for (const name of names) Reflect.deleteProperty(process.env, name);
	Object.assign(process.env, env);
	try {
		run += 1;
		Reflect.deleteProperty(requireCache, fileURLToPath(entrypoint));
		await import(`${entrypoint.href}?run=${run}`);
		wait.checkSync?.();
		const done = wait.done ?? (() => false);
		for (let attempt = 0; attempt < 50 && !done(); attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	} finally {
		for (const name of names) {
			const value = previous[name];
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
		sentry.restore();
	}
}

test('instrumentation loads the Sentry chunk only when a DSN is configured', async () => {
	const unconfigured: string[] = [];
	await runEntrypoint(
		{},
		{
			onImport: () => unconfigured.push('import'),
			onInitialize: () => unconfigured.push('initializeSentry'),
		},
	);
	assert.deepEqual(unconfigured, []);

	const configured: string[] = [];
	await runEntrypoint(
		{ NEXT_PUBLIC_SENTRY_DSN: 'https://public@o123.ingest.sentry.io/1' },
		{
			onImport: () => configured.push('import'),
			onInitialize: () => configured.push('initializeSentry'),
		},
		{ done: () => configured.includes('initializeSentry') },
	);
	assert.deepEqual(configured, ['import', 'initializeSentry']);
});

test('client entrypoint does not load Sentry without a configured DSN', async () => {
	const loads: string[] = [];
	await runEntrypoint({}, { onImport: () => loads.push('loaded'), onInitialize: () => undefined });
	assert.deepEqual(loads, []);
});

test('client entrypoint initializes Sentry once lazily and tolerates a failed optional import', async () => {
	const calls: string[] = [];
	await runEntrypoint(
		{ NEXT_PUBLIC_SENTRY_DSN: 'https://public-key@o123.ingest.de.sentry.io/1' },
		{
			onImport: () => calls.push('loaded'),
			onInitialize: () => calls.push('initialized'),
		},
		{
			checkSync: () => assert.deepEqual(calls, [], 'Sentry loads after the entrypoint ran'),
			done: () => calls.includes('initialized'),
		},
	);
	assert.deepEqual(calls, ['loaded', 'initialized']);

	const failedLoads: string[] = [];
	await runEntrypoint(
		{ NEXT_PUBLIC_SENTRY_DSN: 'configured' },
		{
			onImport: () => {
				failedLoads.push('loaded');
				throw new Error('optional Sentry unavailable');
			},
			onInitialize: () => failedLoads.push('initialized'),
		},
		{
			checkSync: () => assert.deepEqual(failedLoads, []),
			done: () => failedLoads.length > 0,
		},
	);
	assert.deepEqual(failedLoads, ['loaded']);
});
