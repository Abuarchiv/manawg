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

const compiledWrite = transpile('src/core/db/idempotent-write.ts');
const realReplaySlot = evaluate(transpile('src/core/guards/replay-slot.ts'), {});

/**
 * Loads the real `withIdempotentWrite` against a route harness's mocks.
 *
 * Reads, at call time: `@/core/idempotency-store` (`claimResponseSlot`, default "won";
 * `getCachedResponse`, default "nothing stored"), `@/core/db/claimed-response` (else the real
 * helpers on the harness db), `withTransaction` from `@/core/db/transaction` or `@/core/db`, and
 * `@/core/guards/replay-slot` when the harness wants to control polling.
 */
function loadIdempotentWrite(mocks) {
	const TransactionAbort =
		mocks['@/core/db/transaction-abort']?.TransactionAbort ??
		mocks['@/core/db/transaction']?.TransactionAbort ??
		realTransactionAbort.TransactionAbort;
	let claimed = null;
	const claimHelpers = () => {
		if (mocks['@/core/db/claimed-response']) return mocks['@/core/db/claimed-response'];
		claimed ??= loadClaimedResponse(mocks);
		return claimed;
	};
	const store = () => mocks['@/core/idempotency-store'] ?? {};
	return evaluate(compiledWrite, {
		'@/core/db/claimed-response': {
			lockClaimedResponse: (...args) => claimHelpers().lockClaimedResponse(...args),
			completeClaimedResponse: (...args) => claimHelpers().completeClaimedResponse(...args),
			releaseLockedClaim: (...args) => claimHelpers().releaseLockedClaim(...args),
			releaseClaimedResponse: (...args) => claimHelpers().releaseClaimedResponse(...args),
		},
		'@/core/db/transaction': {
			TransactionAbort,
			withTransaction: (...args) =>
				(mocks['@/core/db/transaction']?.withTransaction ?? mocks['@/core/db'].withTransaction)(
					...args,
				),
		},
		'@/core/guards/replay-slot': {
			claimReplaySlot: (...args) =>
				(mocks['@/core/guards/replay-slot'] ?? realReplaySlot).claimReplaySlot(...args),
		},
		'@/core/idempotency-store': {
			claimResponseSlot: (...args) => (store().claimResponseSlot ?? (async () => true))(...args),
			getCachedResponse: (...args) => (store().getCachedResponse ?? (async () => null))(...args),
		},
		'@/core/infra/observability': {
			logApiError: (...args) => mocks['@/core/infra/observability']?.logApiError?.(...args),
		},
	});
}

const compiledParseBody = transpile('src/core/http/parse-body.ts');
const realReadJson = evaluate(transpile('src/core/http/read-json.ts'), {});

/**
 * Loads the real `parseBody` against a route harness's `@/core/http/api-errors` mock. Harnesses
 * that mock `@/core/http/read-json` with only `readJsonLimited` keep reading bodies through it.
 */
function loadParseBody(mocks) {
	const errors = () => mocks['@/core/http/api-errors'] ?? {};
	const readJson = () => mocks['@/core/http/read-json'] ?? realReadJson;
	return evaluate(compiledParseBody, {
		'@/core/http/api-errors': {
			badRequest: (...args) => errors().badRequest(...args),
			payloadTooLarge: (...args) =>
				errors().payloadTooLarge
					? errors().payloadTooLarge(...args)
					: Response.json(
							{ error: 'payload_too_large', code: 'payload_too_large' },
							{ status: 413 },
						),
		},
		'@/core/http/read-json': {
			DEFAULT_JSON_BODY_BYTES: realReadJson.DEFAULT_JSON_BODY_BYTES,
			readJsonBody: async (req, maxBytes) => {
				const module = readJson();
				if (module.readJsonBody) return module.readJsonBody(req, maxBytes);
				try {
					return { ok: true, body: await module.readJsonLimited(req, maxBytes) };
				} catch (err) {
					const tooLarge = err instanceof Error && err.message === 'payload_too_large';
					return { ok: false, reason: tooLarge ? 'payload_too_large' : 'invalid_json' };
				}
			},
		},
	});
}

const compiledStore = transpile('src/core/idempotency-store.ts');

/** Loads the real `@/core/idempotency-store` against the harness's `@/core/db` mock. */
function loadIdempotencyStore(mocks) {
	return evaluate(compiledStore, {
		'@/core/db': {
			get db() {
				return mocks['@/core/db'].db;
			},
			get idempotencyResponses() {
				return mocks['@/core/db'].idempotencyResponses;
			},
		},
		'@/core/guards/api-auth': {
			UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		},
	});
}

module.exports = { loadClaimedResponse, loadIdempotencyStore, loadIdempotentWrite, loadParseBody };
