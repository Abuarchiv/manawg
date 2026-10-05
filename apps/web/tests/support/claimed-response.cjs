const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const webDir = path.resolve(__dirname, '../..');
const requireFromWeb = createRequire(path.join(webDir, 'package.json'));
const { ModuleKind, ScriptTarget, transpileModule } = requireFromWeb('typescript');
const compiled = transpileModule(
	readFileSync(path.join(webDir, 'src/core/db/claimed-response.ts'), 'utf8'),
	{
		compilerOptions: {
			module: ModuleKind.CommonJS,
			target: ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	},
).outputText;

/**
 * Loads the real claim helpers against a route harness's mocks, so replay tests
 * keep exercising the shared protocol instead of a stub.
 *
 * Reads `@/core/db` (db, idempotencyResponses), the `TransactionAbort` class from
 * `@/core/db/transaction` and, when the harness mocks them, `drizzle-orm` and
 * `@/core/infra/observability`. Mock objects are read at call time, so a harness
 * may swap its fake db between requests.
 */
function loadClaimedResponse(mocks) {
	const TransactionAbort =
		mocks['@/core/db/transaction-abort']?.TransactionAbort ??
		mocks['@/core/db/transaction']?.TransactionAbort;
	if (!TransactionAbort) throw new Error('harness mocks no TransactionAbort');
	const helperMocks = {
		'@/core/db': mocks['@/core/db'],
		'@/core/db/transaction-abort': { TransactionAbort },
		'@/core/infra/observability': mocks['@/core/infra/observability'] ?? {
			logApiError: () => undefined,
		},
		'@/core/offline/replay-retention': { RESPONSE_REPLAY_TTL_SECONDS: 7 * 24 * 60 * 60 },
	};
	if (mocks['drizzle-orm']) helperMocks['drizzle-orm'] = mocks['drizzle-orm'];
	const module = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(helperMocks, name) ? helperMocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return module.exports;
}

module.exports = { loadClaimedResponse };
