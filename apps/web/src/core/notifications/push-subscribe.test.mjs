import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const { ModuleKind, ScriptTarget, transpileModule } = requireFromWeb('typescript');

function loadPushSubscribe(apiFetch) {
	const source = readFileSync(
		path.join(process.cwd(), 'src/core/notifications/push-subscribe.ts'),
		'utf8',
	);
	const compiled = transpileModule(source, {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const loaded = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (name === '@/core/infra/api-client' ? { apiFetch } : requireFromWeb(name)),
		loaded,
		loaded.exports,
	);
	return loaded.exports;
}

async function disablePushInOneWg(
	endpointInUse,
	response = { ok: true, data: { ok: true, endpointInUse } },
) {
	let browserUnsubscribed = false;
	const subscription = {
		endpoint: 'https://push.example.test/device',
		unsubscribe: async () => {
			browserUnsubscribed = true;
			return true;
		},
	};
	const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			serviceWorker: {
				ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }),
			},
		},
	});
	try {
		const { unsubscribeWebPush } = loadPushSubscribe(async () => response);
		await unsubscribeWebPush('MTE8PZAT', 'member-a').catch(() => undefined);
	} finally {
		if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
	return browserUnsubscribed;
}

test('turning push off in one WG keeps the browser subscription another WG still uses', async () => {
	assert.equal(await disablePushInOneWg(true), false);
});

test('turning push off in the last WG that uses it unsubscribes the browser', async () => {
	assert.equal(await disablePushInOneWg(false), true);
});

test('a failed server opt-out keeps the browser subscription other WGs may share', async () => {
	assert.equal(
		await disablePushInOneWg(false, { ok: false, status: 0, error: 'Netzwerkfehler' }),
		false,
	);
});
