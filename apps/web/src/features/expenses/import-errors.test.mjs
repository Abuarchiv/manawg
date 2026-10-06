import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));

function loadTs(relativePath, resolve) {
	const source = transpileModule(readFileSync(path.join(process.cwd(), relativePath), 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const loaded = { exports: {} };
	new Function('require', 'module', 'exports', source)(resolve, loaded, loaded.exports);
	return loaded.exports;
}

const errorCodes = loadTs('src/core/http/error-codes.ts', requireFromWeb);
const { importActionErrorMessage, recoveryActionFor } = loadTs(
	'src/features/expenses/import-errors.ts',
	(name) => (name === '@/core/http/error-codes' ? errorCodes : requireFromWeb(name)),
);

test('rate limits from middleware and routes read the same and offer a retry', () => {
	for (const code of ['rate_limited', 'too_many_requests', 'import_rate_limited']) {
		assert.match(importActionErrorMessage(code), /Zu viele Importversuche/);
		assert.equal(recoveryActionFor(code, 'commit')?.kind, 'retry_commit');
	}
});

test('each error leads to the step that can fix it', () => {
	assert.equal(recoveryActionFor('payer_unmapped', 'commit')?.kind, 'mapping');
	assert.equal(recoveryActionFor('paid_by_must_include_caller', 'commit')?.kind, 'input');
	assert.equal(recoveryActionFor('preview_hash_required', 'commit')?.kind, 'preview');
	assert.equal(recoveryActionFor('db_error', 'preview')?.kind, 'retry_preview');
	assert.equal(recoveryActionFor('something_new', 'preview'), null);
});

test('an unknown error still gets a readable fallback', () => {
	assert.match(importActionErrorMessage('something_new'), /nicht abgeschlossen/);
});
