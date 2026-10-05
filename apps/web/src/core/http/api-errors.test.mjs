import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const source = transpileModule(
	readFileSync(path.join(process.cwd(), 'src/core/http/api-errors.ts'), 'utf8'),
	{ compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(
	(name) =>
		name === '@/core/infra/observability' ? { captureException: () => {} } : requireFromWeb(name),
	loaded,
	loaded.exports,
);
const { unreadableJsonBody } = loaded.exports;

test('an oversized body answers 413 so the client shortens it instead of retrying', async () => {
	const response = unreadableJsonBody(new Error('payload_too_large'));
	assert.equal(response.status, 413);
	assert.deepEqual(await response.json(), {
		error: 'payload_too_large',
		code: 'payload_too_large',
	});
});

test('malformed or missing JSON answers 400 invalid_json', async () => {
	for (const err of [new Error('invalid_json'), new SyntaxError('Unexpected token'), 'oops']) {
		const response = unreadableJsonBody(err);
		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), { error: 'invalid_json' });
	}
});
