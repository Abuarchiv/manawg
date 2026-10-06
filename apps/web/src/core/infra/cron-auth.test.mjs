import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

// Loaded through CommonJS: Node's ESM resolver cannot resolve `next/server`
// without a file extension.
const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const source = transpileModule(
	readFileSync(path.join(process.cwd(), 'src/core/infra/cron-auth.ts'), 'utf8'),
	{ compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(requireFromWeb, loaded, loaded.exports);
const { requireCronSecret } = loaded.exports;

function request(authorization) {
	return new Request('https://app.example/api/cron/maintenance', {
		headers: authorization ? { authorization } : {},
	});
}

function withSecret(value, run) {
	const previous = process.env.CRON_SECRET;
	if (value === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
	else process.env.CRON_SECRET = value;
	try {
		return run();
	} finally {
		if (previous === undefined) Reflect.deleteProperty(process.env, 'CRON_SECRET');
		else process.env.CRON_SECRET = previous;
	}
}

test('cron routes fail closed when CRON_SECRET is not configured', () => {
	const response = withSecret(undefined, () => requireCronSecret(request('Bearer anything')));
	assert.equal(response?.status, 503);
});

test('a wrong or missing bearer token is rejected', () => {
	withSecret('s3cret', () => {
		assert.equal(requireCronSecret(request('Bearer wrong'))?.status, 401);
		assert.equal(requireCronSecret(request(null))?.status, 401);
	});
});

test('the configured bearer token is accepted', () => {
	assert.equal(
		withSecret('s3cret', () => requireCronSecret(request('Bearer s3cret'))),
		null,
	);
});
