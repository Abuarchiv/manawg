import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';

// Import warning persistence: the committed import row receives a scoped JSONB warning update,
// and the commit route answers with the known warning even when persisting it fails. The real
// idempotency store runs against a fake db; the route's collaborators are stubbed.

const schema = await import('../src/core/db/schema.ts');
const { idempotencyResponses } = schema;

type Warning = 'notification_delivery_failed' | 'notification_delivery_unknown';
const warning: Warning = 'notification_delivery_failed';
const KEY = '11111111-1111-4111-8111-111111111111';

const dialect = new PgDialect();
const db = {
	mode: 'saved' as 'saved' | 'missing' | 'throws',
	setSql: '',
	where: { sql: '', params: [] as unknown[] },
	updates: 0,
	update: () => ({
		set: (values: { responseBody: SQL }) => ({
			where: (condition: SQL) => ({
				returning: async () => {
					db.updates += 1;
					db.setSql = dialect.sqlToQuery(values.responseBody).sql;
					db.where = dialect.sqlToQuery(condition);
					if (db.mode === 'throws') throw new Error('db_unavailable');
					return db.mode === 'saved' ? [{ scope: 'import-commit:wg:member' }] : [];
				},
			}),
		}),
	}),
};

let logs = 0;
let committedInput: unknown;
let commitResult: () => Promise<unknown> = async () => ({
	importId: 'import-1',
	inserted: 1,
	skipped: 0,
	errors: [],
	warning,
});

mock.module('@/core/db', { namedExports: { db, idempotencyResponses } });
mock.module('@/core/db/transaction', { namedExports: { TransactionAbort } });
mock.module('@/core/guards/api-auth', {
	namedExports: {
		UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	},
});
mock.module('@/core/http/api-errors', {
	namedExports: {
		badRequest: () => new Response(null, { status: 400 }),
		conflict: () => new Response(null, { status: 409 }),
		serverError: () => new Response(null, { status: 500 }),
		tooMany: () => new Response(null, { status: 429 }),
		rateLimitResponse: (result: { success: boolean }) =>
			result.success ? null : new Response(null, { status: 429 }),
	},
});
mock.module('@/core/guards/admin', { namedExports: { isWgAdmin: async () => false } });
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
			member: { memberId: 'member', name: 'Member' },
		}),
	},
});
mock.module('@/core/guards/route-preamble', {
	namedExports: { readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }) },
});
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: () => logs++, captureException: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		importCommitLimiter: {},
	},
});
mock.module('@/features/expenses/import-body', {
	namedExports: {
		MAX_CSV_BYTES: 5 * 1024 * 1024,
		MAX_IMPORT_ROWS: 5_000,
		MAX_OCR_BYTES: 1024 * 1024,
		readImportJsonBody: async (req: Request) => ({ ok: true, value: await req.json() }),
	},
});
mock.module('@/features/expenses/server/import-commit', {
	namedExports: {
		commitImport: async (
			_replay: unknown,
			prepare: () => Promise<{ stop: Response } | { input: unknown }>,
		) => {
			const prepared = await prepare();
			if ('stop' in prepared) return { kind: 'stopped', response: prepared.stop };
			committedInput = prepared.input;
			return { kind: 'committed', result: await commitResult() };
		},
	},
});
mock.module('@/features/expenses/server/import-hash', {
	namedExports: { hashPayload: () => 'hash' },
});
mock.module('@/features/expenses/import-parsers', {
	namedExports: {
		findMappingConflicts: () => [],
		parseSplidCsv: () => [{ paidByName: 'Member', splits: [] }],
		parseSplitwiseCsv: () => [{ paidByName: 'Member', splits: [] }],
	},
});
mock.module('@/features/expenses/ocr', {
	namedExports: { parseOcrText: () => ({ expenses: [] }) },
});
mock.module('next/server', {
	namedExports: { NextResponse: { json: (body: unknown) => Response.json(body) } },
});

const { setReplayWarning } = await import('../src/core/idempotency-store.ts');
const route = await import('../src/app/api/wg/[code]/imports/commit/route.ts');

function post(memberMapping: unknown = {}) {
	committedInput = undefined;
	return route.POST(
		Object.assign(
			new Request('https://example.invalid', {
				method: 'POST',
				headers: { 'idempotency-key': KEY },
				body: JSON.stringify({ source: 'splitwise_csv', payload: 'data', memberMapping }),
			}),
			{ cookies: { get: () => undefined } },
		) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
	);
}

/** Runs one route call against a persistence outcome and reports the error logs it caused. */
async function postWith(mode: typeof db.mode, commit?: () => Promise<unknown>) {
	db.mode = mode;
	logs = 0;
	commitResult =
		commit ??
		(async () => ({ importId: 'import-1', inserted: 1, skipped: 0, errors: [], warning }));
	const response = await post();
	return { response, logs };
}

test('warning update targets the committed import row with a scoped JSONB update', async () => {
	db.mode = 'saved';
	const persisted = await setReplayWarning(
		'import-commit:wg:member',
		'key',
		{
			match: [{ path: ['importId'], equals: 'import-1' }],
			warningPath: ['warning'],
			replaces: [null, warning],
		},
		warning,
	);
	assert.equal(persisted, true);
	assert.match(db.setSql, /jsonb_set/);
	assert.match(db.where.sql, /expires_at/);
	assert.match(db.where.sql, /importId/);
	assert.ok(db.where.params.includes('import-1'));
});

test('immediate response preserves a known warning when persistence fails', async () => {
	const saved = await postWith('saved');
	assert.equal(saved.response.status, 200);
	assert.equal((await saved.response.json()).warning, warning);
	assert.equal(saved.logs, 0);

	const missing = await postWith('missing');
	assert.equal((await missing.response.json()).warning, warning);
	assert.equal(missing.logs, 1);

	const failed = await postWith('throws');
	assert.equal((await failed.response.json()).warning, warning);
	assert.equal(failed.logs, 1);
});

// Releasing the claim after a failed commit is the primitive's job (tests/idempotent-write).
test('a failed commit answers with the real error on every same-key retry', async () => {
	const failing = () => Promise.reject(new Error('member_not_in_wg'));
	assert.equal((await postWith('saved', failing)).response.status, 400);
	assert.equal((await postWith('saved', failing)).response.status, 400);

	assert.equal((await postWith('saved')).response.status, 200);
});

test('commit wire validation preserves __proto__ as an own mapping key', async () => {
	const mapping = Object.fromEntries([['__proto__', KEY]]);
	const response = await post(mapping);
	assert.equal(response.status, 200);
	assert.ok(committedInput && typeof committedInput === 'object' && 'mapping' in committedInput);
	const committedMapping = Reflect.get(committedInput, 'mapping');
	assert.ok(committedMapping && typeof committedMapping === 'object');
	assert.equal(Object.hasOwn(committedMapping, '__proto__'), true);
	assert.equal(Reflect.get(committedMapping, '__proto__'), KEY);
});

test('commit wire validation still rejects invalid mapping shapes and UUIDs', async () => {
	for (const memberMapping of [null, [], 'invalid', { Anna: 'not-a-uuid' }]) {
		assert.equal((await post(memberMapping)).status, 400);
		assert.equal(committedInput, undefined);
	}
});
