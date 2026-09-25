import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

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
new Function('module', 'exports', compiled)(loaded, loaded.exports);
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
