import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const { transpileModule, ModuleKind } = createRequire(path.join(process.cwd(), 'package.json'))(
	'typescript',
);
const mod = { exports: {} };
const source = readFileSync(path.join(process.cwd(), 'src/core/auth/password-errors.ts'), 'utf8');
new Function(
	'module',
	'exports',
	transpileModule(source, {
		compilerOptions: { module: ModuleKind.CommonJS },
	}).outputText,
)(mod, mod.exports);
const { classifyAuthError } = mod.exports;

test('classifies Supabase auth errors for German messages', () => {
	assert.equal(classifyAuthError({ code: 'invalid_credentials', status: 400 }), 'credentials');
	assert.equal(classifyAuthError({ code: 'email_not_confirmed', status: 400 }), 'unconfirmed');
	assert.equal(classifyAuthError({ status: 429 }), 'rate-limit');
	assert.equal(classifyAuthError({ code: 'over_email_send_rate_limit' }), 'rate-limit');
	assert.equal(classifyAuthError({ name: 'AuthRetryableFetchError' }), 'network');
	assert.equal(classifyAuthError(new Error('x')), 'other');
});
