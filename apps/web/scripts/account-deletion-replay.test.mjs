import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const webDir = path.resolve(import.meta.dirname, '..');
const requireFromWeb = createRequire(path.join(webDir, 'package.json'));
const { ModuleKind, ScriptTarget, transpileModule } = requireFromWeb('typescript');

function load(cached) {
	const mocks = {
		'@/core/guards/replay-slot': { claimReplaySlot: async () => ({ won: false, cached }) },
		'@/core/idempotency': {
			claimResponseSlot: async () => true,
			getCachedResponse: async () => cached,
			readIdempotencyKey: (req) => req.headers.get('idempotency-key'),
			setCachedResponse: async () => undefined,
		},
		'next/server': { NextResponse: Response },
	};
	const source = readFileSync(path.join(webDir, 'src/core/guards/idempotency.ts'), 'utf8');
	const compiled = transpileModule(source, {
		compilerOptions: {
			module: ModuleKind.CommonJS,
			target: ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(mocks, name) ? mocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return module.exports;
}

test('a cached membership response is blocked when the account fence is present', async () => {
	const cached = { status: 200, body: { memberId: 'detached-member', token: 'old-token' } };
	const { withIdempotentJsonResponse } = load(cached);
	let handlerCalled = false;
	let gateCalled = false;
	const response = await withIdempotentJsonResponse(
		new Request('https://example.test/api/wg/members', {
			headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
		}),
		'wg-join:account',
		async () => {
			handlerCalled = true;
			return Response.json({ ok: true });
		},
		async () => {
			gateCalled = true;
			return Response.json({ error: 'account_deletion_pending' }, { status: 409 });
		},
	);
	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), { error: 'account_deletion_pending' });
	assert.equal(gateCalled, true);
	assert.equal(handlerCalled, false);
});

test('a cached response still replays when the fresh account gate allows it', async () => {
	const cached = { status: 200, body: { ok: true } };
	const { withIdempotentJsonResponse } = load(cached);
	const response = await withIdempotentJsonResponse(
		new Request('https://example.test/api/wg/members', {
			headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
		}),
		'wg-join:account',
		async () => Response.json({ ok: false }),
		async () => null,
	);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true });
});
