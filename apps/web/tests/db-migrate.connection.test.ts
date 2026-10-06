import assert from 'node:assert/strict';
import test from 'node:test';
import {
	resolveConnectionString,
	validateSupabaseDirectUrl,
} from '../scripts/db-migrate/connection.mjs';
import { errorCodeSuffix, safeFailureReason } from '../scripts/db-migrate/failure.mjs';

/** Process env as Next's augmented `ProcessEnv` type requires it. */
const env = (vars: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', ...vars });

const DIRECT = 'postgresql://migrator:example@db.project.supabase.co:5432/postgres?sslmode=require';

test('resolveConnectionString prefers DATABASE_MIGRATION_URL over every runtime URL', () => {
	assert.equal(
		resolveConnectionString(
			env({
				DATABASE_MIGRATION_URL: DIRECT,
				POSTGRES_URL:
					'postgresql://other:example@db.other.supabase.co:5432/postgres?sslmode=require',
				POSTGRES_URL_NON_POOLING: 'not-a-url',
			}),
		),
		DIRECT,
	);
});

test('resolveConnectionString strips a Neon -pooler label from the runtime URL', () => {
	assert.equal(
		resolveConnectionString(
			env({
				DATABASE_URL:
					'postgresql://u:p@ep-cool-name-pooler.eu-central-1.aws.neon.tech:5432/db?sslmode=require',
			}),
		),
		'postgresql://u:p@ep-cool-name.eu-central-1.aws.neon.tech:5432/db?sslmode=require',
	);
});

test('resolveConnectionString falls back to the non-pooling pair and validates it', () => {
	assert.equal(resolveConnectionString(env({ DATABASE_URL_UNPOOLED: DIRECT })), DIRECT);
	assert.throws(
		() =>
			resolveConnectionString(
				env({ POSTGRES_URL_NON_POOLING: DIRECT.replace(':5432/', ':6543/') }),
			),
		/^Error: POSTGRES_URL_NON_POOLING\/DATABASE_URL_UNPOOLED must not use port 6543/,
	);
});

test('resolveConnectionString names the variables to set when none is present', () => {
	assert.throws(() => resolveConnectionString(env({})), {
		message: 'No database URL. Set DATABASE_MIGRATION_URL, POSTGRES_URL or DATABASE_URL.',
	});
});

test('validateSupabaseDirectUrl accepts only direct Supabase hosts on port 5432', () => {
	assert.doesNotThrow(() => validateSupabaseDirectUrl(DIRECT, 'migration'));
	for (const url of [
		'postgresql://u:p@localhost:5432/postgres',
		'postgresql://u:p@db.example.test:5432/postgres?sslmode=require',
		'postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require',
		'mysql://u:p@db.project.supabase.co:5432/postgres?sslmode=require',
	]) {
		assert.throws(() => validateSupabaseDirectUrl(url, 'migration'), {
			message: 'migration must be a direct Supabase PostgreSQL connection on port 5432.',
		});
	}
});

test('safeFailureReason maps errors to fixed slugs without echoing their text', () => {
	const cases = [
		['Database check failed: unexpected migration row 3 outside ...', 'unexpected-migration-row'],
		['migration ledger is not a canonical prefix; expected x', 'non-canonical-ledger'],
		['timestamp mismatch for migration 0001_x', 'migration-timestamp'],
		['invalid migration hash in ledger row 2', 'invalid-ledger-value'],
		['duplicate migration 0001_x', 'duplicate-migration'],
		['Drizzle migration ledger is missing.', 'missing-ledger'],
		['syntax error at or near "x"', 'sql-syntax'],
		['relation "wgs" does not exist', 'missing-relation'],
		['column "x" does not exist', 'missing-column'],
		['relation "wgs" already exists', 'duplicate-object'],
		['permission denied for schema drizzle', 'permission-schema'],
		['must be owner of table wgs', 'owner-table'],
		['permission denied to create extension', 'permission'],
		['secret password=hunter2 rejected', 'unclassified'],
	];
	for (const [message, reason] of cases) {
		assert.equal(safeFailureReason(new Error(message)), reason, message);
	}
	assert.equal(
		safeFailureReason(
			new Error('Failed query', { cause: new Error('relation "x" already exists') }),
		),
		'duplicate-object',
	);
	assert.equal(safeFailureReason(undefined), 'unclassified');
});

test('errorCodeSuffix reports SQLSTATE-like codes from the error or its cause only', () => {
	assert.equal(errorCodeSuffix(Object.assign(new Error('x'), { code: '42501' })), ' [code=42501]');
	assert.equal(
		errorCodeSuffix(new Error('x', { cause: Object.assign(new Error('y'), { code: '57P01' }) })),
		' [code=57P01]',
	);
	assert.equal(errorCodeSuffix(Object.assign(new Error('x'), { code: '08P' })), '');
	assert.equal(errorCodeSuffix(Object.assign(new Error('x'), { code: 'bad code' })), '');
	assert.equal(errorCodeSuffix(Object.assign(new Error('x'), { code: 42501 })), '');
	assert.equal(errorCodeSuffix('plain string'), '');
	assert.equal(errorCodeSuffix(null), '');
});
