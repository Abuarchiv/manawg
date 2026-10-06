const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const webDir = path.resolve(__dirname, '../..');
const requireFromWeb = createRequire(path.join(webDir, 'package.json'));
const { ModuleKind, ScriptTarget, transpileModule } = requireFromWeb('typescript');

function transpile(file) {
	return transpileModule(readFileSync(path.join(webDir, file), 'utf8'), {
		compilerOptions: {
			module: ModuleKind.CommonJS,
			target: ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	}).outputText;
}

function evaluate(compiled, mocks) {
	const module = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(mocks, name) ? mocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return module.exports;
}

const compiled = transpile('src/core/db/claimed-response.ts');
const realTransactionAbort = evaluate(transpile('src/core/db/transaction-abort.ts'), {});

/**
 * Loads the real claim helpers against a route harness's mocks, so replay tests
 * keep exercising the shared protocol instead of a stub.
 *
 * Reads `@/core/db` (db, idempotencyResponses) and, when the harness mocks them,
 * the `TransactionAbort` class from `@/core/db/transaction`, `drizzle-orm` and
 * `@/core/infra/observability`. Routes compare aborts with `instanceof`, so a
 * harness that mocks `TransactionAbort` gets errors of its own class. Mock
 * objects are read at call time, so a harness may swap its fake db between
 * requests.
 */
function loadClaimedResponse(mocks) {
	const TransactionAbort =
		mocks['@/core/db/transaction-abort']?.TransactionAbort ??
		mocks['@/core/db/transaction']?.TransactionAbort ??
		realTransactionAbort.TransactionAbort;
	const helperMocks = {
		'@/core/db': mocks['@/core/db'],
		'@/core/db/transaction-abort': { TransactionAbort },
		'@/core/infra/observability': mocks['@/core/infra/observability'] ?? {
			logApiError: () => undefined,
		},
		'@/core/offline/replay-retention': { RESPONSE_REPLAY_TTL_SECONDS: 7 * 24 * 60 * 60 },
	};
	if (mocks['drizzle-orm']) helperMocks['drizzle-orm'] = mocks['drizzle-orm'];
	return evaluate(compiled, helperMocks);
}

module.exports = { loadClaimedResponse };
