// Run with the unit-test resolver and module mocks (see the `analytics:check` script): the real
// src/instrumentation-client.ts is evaluated once per case against a stand-in PostHog SDK.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../src/', import.meta.url);
const [createFlow, joinFlow, pwa] = await Promise.all([
	readFile(new URL('app/neu/use-create-wg.ts', root), 'utf8'),
	readFile(new URL('app/neu/use-join-wg.ts', root), 'utf8'),
	readFile(new URL('components/app/PwaRegister.tsx', root), 'utf8'),
]);
const onboarding = createFlow + joinFlow;

mock.module('@/core/infra/sentry', { namedExports: { initializeSentry() {} } });
Object.defineProperty(globalThis, 'window', {
	configurable: true,
	value: { location: { hostname: 'app.manawg.com' } },
});
Object.defineProperty(globalThis, 'navigator', {
	configurable: true,
	value: { userAgent: 'ManaWG-privacy-check' },
});

const ENV_NAMES = [
	'NODE_ENV',
	'NEXT_PUBLIC_SENTRY_DSN',
	'NEXT_PUBLIC_POSTHOG_KEY',
	'NEXT_PUBLIC_POSTHOG_HOST',
];
let run = 0;

/** Evaluates the client entrypoint once with `env`; resolves to the SDK loads and init calls. */
async function initialize(env, failImport = false, failInit = false) {
	const calls = [];
	let imports = 0;
	// The SDK loads asynchronously; a load ends in init() or in the warning of the failure branch.
	let settle = () => {};
	const settled = new Promise((resolve) => {
		settle = resolve;
	});
	// A fresh SDK mock per case: its exports are read when the entrypoint imports it.
	const sdk = mock.module('posthog-js', {
		defaultExport: {
			init(key, config) {
				if (failInit) throw new Error('initialization failed');
				calls.push({ key, config });
				settle();
			},
		},
		namedExports: {
			get loaded() {
				imports++;
				if (failImport) throw new Error('provider blocked');
				return true;
			},
		},
	});
	const previousEnv = ENV_NAMES.map((name) => [name, process.env[name]]);
	for (const name of ENV_NAMES) delete process.env[name];
	Object.assign(process.env, env);
	const restoreConsole = [
		mock.method(console, 'warn', settle),
		mock.method(console, 'error', () => {}),
	];
	try {
		run++;
		await import(new URL(`instrumentation-client.ts?run=${run}`, root).href);
		// A configuration that must not load the SDK never settles; the wait lets a wrong load show.
		await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 500))]);
	} finally {
		for (const spy of restoreConsole) spy.mock.restore();
		for (const [name, value] of previousEnv) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		sdk.restore();
	}
	return { calls, imports };
}

const env = {
	NODE_ENV: 'production',
	NEXT_PUBLIC_POSTHOG_KEY: 'phc_privacy_test',
	NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
};
const { calls, imports } = await initialize(env);
assert.equal(imports, 1);
assert.equal(calls.length, 1);
assert.equal(calls[0].key, env.NEXT_PUBLIC_POSTHOG_KEY);
const { config } = calls[0];
for (const [name, expected] of Object.entries({
	api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
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
}))
	assert.equal(config[name], expected, `unsafe privacy setting: ${name}`);

assert.equal(typeof config.before_send, 'function');
assert.equal(config.before_send(null), null);
const uuid = '12345678-1234-4234-8234-123456789abc';
const timestamp = new Date('2026-09-03T00:00:00.000Z');
const secret = 'private-household-content';
for (const event of ['$pageview', 'wg_created', 'wg_joined']) {
	const cleaned = config.before_send({
		uuid,
		event,
		timestamp,
		$set: { email: secret },
		$set_once: { name: secret },
		$unset: [secret],
		extra: secret,
		properties: {
			$host: secret,
			$raw_user_agent: secret,
			$cookieless_mode: false,
			$process_person_profile: true,
			token: secret,
			distinct_id: secret,
			$session_id: secret,
			$device_id: secret,
			$current_url: `https://app.manawg.com/wg/${secret}?code=${secret}`,
			$pathname: `/wg/${secret}`,
			$referrer: secret,
			title: secret,
			$initial_current_url: secret,
			$prev_pageview_pathname: secret,
			$set: { email: secret },
			$set_once: { name: secret },
			nested: { content: secret },
		},
	});
	assert.ok(cleaned.timestamp instanceof Date);
	assert.deepEqual(JSON.parse(JSON.stringify(cleaned)), {
		uuid,
		event,
		timestamp: timestamp.toISOString(),
		properties: {
			token: env.NEXT_PUBLIC_POSTHOG_KEY,
			distinct_id: '$posthog_cookieless',
			$cookieless_mode: true,
			$process_person_profile: false,
			$host: 'app.manawg.com',
			$raw_user_agent: 'ManaWG-privacy-check',
		},
	});
}
for (const event of [
	'$identify',
	'$set',
	'$exception',
	'$pageleave',
	'$feature_flag_called',
	'chat_message_sent',
	'chore_created',
	'expense_saved',
	secret,
]) {
	assert.equal(config.before_send({ uuid, event, timestamp, properties: {} }), null);
}
assert.equal(
	config.before_send({ uuid: secret, event: 'wg_created', timestamp, properties: {} }),
	null,
);
assert.equal(
	config.before_send({ uuid, event: 'wg_created', timestamp: secret, properties: {} }),
	null,
);
assert.equal(
	config.before_send({ uuid, event: 'wg_created', timestamp: new Date('invalid'), properties: {} }),
	null,
);
for (const invalidEnv of [
	{},
	{ ...env, NEXT_PUBLIC_POSTHOG_KEY: '' },
	{ ...env, NEXT_PUBLIC_POSTHOG_HOST: '' },
	...[
		'https://us.i.posthog.com',
		'http://eu.i.posthog.com',
		'https://eu.i.posthog.com.evil.example',
		'https://eu.i.posthog.com/path',
	].map((host) => ({ ...env, NEXT_PUBLIC_POSTHOG_HOST: host })),
]) {
	assert.deepEqual(await initialize(invalidEnv), { calls: [], imports: 0 });
}
assert.equal((await initialize(env, true)).calls.length, 0);
assert.equal((await initialize(env, false, true)).calls.length, 0);
assert.doesNotMatch(pwa, /posthog|onAuthStateChange|createSupabaseBrowserClient/);

const captureCalls = [...onboarding.matchAll(/posthog\.capture\(([^)]*)\)/g)].map(
	(match) => match[1],
);
assert.deepEqual(captureCalls, ["'wg_created'", "'wg_joined'"]);

// Minimal analytics contract: only $pageview (autocaptured via
// capture_pageview, never an explicit capture call) plus the two permitted
// activation captures wg_created / wg_joined may exist in product source.
// Scan every product-source capture call so dead events fail closed here
// even though runtime before_send already drops them.
const ALLOWED_CAPTURE_EVENTS = new Set(['wg_created', 'wg_joined']);
const srcDir = fileURLToPath(root);
async function collectSourceFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await collectSourceFiles(full)));
		else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) files.push(full);
	}
	return files;
}
const sourceFiles = (await collectSourceFiles(srcDir)).filter(
	(file) => !/\.(test|spec)\./.test(path.basename(file)),
);
const allCaptures = [];
for (const file of sourceFiles) {
	const content = await readFile(file, 'utf8');
	for (const match of content.matchAll(/posthog\.capture\(\s*['"]([^'"]+)['"]/g)) {
		allCaptures.push(`${path.relative(srcDir, file)}: ${match[1]}`);
	}
}
const allEvents = allCaptures.map((item) => {
	const delimiter = item.lastIndexOf(': ');
	return item.slice(delimiter + 2);
});
const uniqueEvents = [...new Set(allEvents)].sort();
assert.deepEqual(
	uniqueEvents,
	[...ALLOWED_CAPTURE_EVENTS].sort(),
	`non-activation analytics calls contradict the minimal contract: ${allCaptures.join(', ') || 'none found'}`,
);
assert.equal(
	allEvents.length,
	uniqueEvents.length,
	`duplicate analytics captures are not allowed: ${allCaptures.join(', ')}`,
);

process.stdout.write('analytics privacy check passed\n');
