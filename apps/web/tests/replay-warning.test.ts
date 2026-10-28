import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { jsonb, PgDialect, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// setReplayWarning against a fake db that records the generated SQL; the row matching is the
// database's job, so the test checks which conditions reach it.

const idempotencyResponses = pgTable('idempotency_responses', {
	scope: text('scope'),
	key: text('key'),
	responseBody: jsonb('response_body'),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
});
const dialect = new PgDialect();
/** SQL text without table qualifiers, so assertions read like the statement. */
function render(query: SQL) {
	const { sql, params } = dialect.sqlToQuery(query);
	return { sql: sql.replaceAll('"idempotency_responses".', ''), params };
}
const captured: Array<{
	set: { sql: string; params: unknown[] };
	where: { sql: string; params: unknown[] };
}> = [];
let matchedRows = 1;

mock.module('@/core/db', {
	namedExports: {
		idempotencyResponses,
		db: {
			update: () => ({
				set: (values: { responseBody: SQL }) => ({
					where: (condition: SQL) => ({
						returning: async () => {
							captured.push({
								set: render(values.responseBody),
								where: render(condition),
							});
							return Array.from({ length: matchedRows }, () => ({ scope: 's' }));
						},
					}),
				}),
			}),
		},
	},
});
mock.module('@/core/guards/api-auth', { namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i } });

const { setReplayWarning } = await import('../src/core/idempotency-store.ts');

const target = {
	match: [{ path: ['body', 'event', 'id'], equals: 'event-1' }],
	warningPath: ['body', 'warning'],
	replaces: [null, 'notification_delivery_failed'],
};

test('the warning lands at its path, only on the live response of the matching row', async () => {
	captured.length = 0;
	matchedRows = 1;
	assert.equal(
		await setReplayWarning('scope-1', 'key-1', target, 'notification_delivery_failed'),
		true,
	);
	const [query] = captured;
	assert.ok(query);
	assert.match(
		query.set.sql,
		/jsonb_set\("response_body", '\{body,warning\}', to_jsonb\(\$1::text\)\)/,
	);
	assert.deepEqual(query.set.params, ['notification_delivery_failed']);
	assert.match(query.where.sql, /"scope" = \$1/);
	assert.match(query.where.sql, /"key" = \$2/);
	assert.match(query.where.sql, /"expires_at" > \$3/);
	assert.match(query.where.sql, /"response_body" #>> '\{body,event,id\}' = \$4/);
	assert.match(
		query.where.sql,
		/"response_body" #> '\{body,warning\}' = 'null'::jsonb or "response_body" #> '\{body,warning\}' = to_jsonb\(\$5::text\)/,
	);
	assert.deepEqual(query.where.params.slice(0, 2), ['scope-1', 'key-1']);
	assert.equal(query.where.params[3], 'event-1');
	assert.equal(query.where.params[4], 'notification_delivery_failed');
});

test('a missing or already enriched row reports false', async () => {
	matchedRows = 0;
	assert.equal(
		await setReplayWarning('scope-1', 'key-1', target, 'notification_delivery_unknown'),
		false,
	);
});

test('a null warning is written as JSON null', async () => {
	captured.length = 0;
	matchedRows = 1;
	await setReplayWarning(
		'scope-1',
		'key-1',
		{ ...target, replaces: ['notification_delivery_unknown'] },
		null,
	);
	assert.match(captured[0]?.set.sql ?? '', /'null'::jsonb/);
});

test('JSON paths accept only plain identifiers', async () => {
	await assert.rejects(
		setReplayWarning('s', 'k', { ...target, warningPath: ["warning'; drop"] }, null),
		/replay_warning_path_invalid/,
	);
});
