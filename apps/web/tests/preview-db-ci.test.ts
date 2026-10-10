import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { previewSessionDatabaseUrl } from '../scripts/db-migrate.mjs';

// Preview CI database transport and the credential-hiding wrapper around db-migrate.

const SOURCE =
	'postgresql://manawg_preview_ci:synthetic%40pass%3A%25@db.sthiwjebcwwiphashgla.supabase.co:5432/postgres?sslmode=verify-full';
const WRAPPER = fileURLToPath(new URL('../scripts/preview-db-check.mjs', import.meta.url));
const MIGRATE = fileURLToPath(new URL('../scripts/db-migrate.mjs', import.meta.url));

type ChildOutcome = { status: number | null; signal: string | null; error: Error | undefined };
let childOutcome: ChildOutcome = { status: 0, signal: null, error: undefined };
let childSecret = '';

// The wrapper runs on import, so its child process is replaced by a controllable stub.
mock.module('node:child_process', {
	namedExports: {
		spawnSync: () => ({ ...childOutcome, stdout: childSecret, stderr: childSecret }),
	},
});

test('Preview CI changes only its transport and preserves encoded credentials and verified TLS', () => {
	const source = new URL(SOURCE);
	const result = new URL(previewSessionDatabaseUrl(SOURCE));
	assert.equal(result.hostname, 'aws-0-eu-central-1.pooler.supabase.com');
	assert.equal(result.port, '5432');
	assert.equal(result.username, 'manawg_preview_ci.sthiwjebcwwiphashgla');
	assert.equal(result.password, source.password);
	assert.equal(result.pathname, '/postgres');
	assert.equal(result.search, '?sslmode=verify-full');
});

test('Preview CI rejects other projects, roles, transports and driver URL overrides', () => {
	const invalid = [
		'not-a-url',
		SOURCE.replace('postgresql:', 'https:'),
		SOURCE.replace('sthiwjebcwwiphashgla', 'bwsvsvfgbrsonepffqff'),
		SOURCE.replace('manawg_preview_ci:', 'postgres:'),
		SOURCE.replace('synthetic%40pass%3A%25', ''),
		SOURCE.replace(':5432/', ':6543/'),
		SOURCE.replace('/postgres?', '/other?'),
		SOURCE.replace('verify-full', 'require'),
		`${SOURCE}#fragment`,
		...['host', 'hostaddr', 'port', 'user', 'password', 'options', 'sslrootcert', 'sslmode'].map(
			(key) => `${SOURCE}&${key}=override`,
		),
	];
	for (const value of invalid) assert.throws(() => previewSessionDatabaseUrl(value));
});

test('Preview wrapper fails closed without exposing child credentials or error streams', () => {
	const secret = 'SYNTHETIC_CREDENTIAL_MUST_NOT_APPEAR';
	const child = spawnSync(process.execPath, [WRAPPER], {
		encoding: 'utf8',
		env: {
			...process.env,
			DATABASE_MIGRATION_URL: `postgresql://postgres:${secret}@db.bwsvsvfgbrsonepffqff.supabase.co:5432/postgres?sslmode=verify-full`,
		},
		timeout: 10_000,
	});
	assert.equal(child.error, undefined);
	assert.equal(child.status, 1);
	assert.equal(child.stdout, '');
	assert.equal(
		child.stderr.trim(),
		'[preview-db] migration failed (class=configuration, code=unknown, stage=connection-config, reason=unclassified, ledger=none, exit=1, signal=none).',
	);
	assert.ok(!child.stderr.includes(secret));
});

test('the ordinary migration entrypoint still rejects session endpoints before connecting', () => {
	const child = spawnSync(process.execPath, [MIGRATE, '--check'], {
		encoding: 'utf8',
		env: {
			...process.env,
			DATABASE_MIGRATION_URL: previewSessionDatabaseUrl(SOURCE),
			MANAWG_PREVIEW_CI_SESSION: '',
		},
		timeout: 10_000,
	});
	assert.equal(child.error, undefined);
	assert.equal(child.status, 1);
	assert.match(child.stderr, /must be a direct Supabase PostgreSQL connection on port 5432/);
});

test('wrapper never forwards secret-bearing child output, including success and process errors', async (t) => {
	childSecret = 'SYNTHETIC_CHILD_SECRET';
	const previousExitCode = process.exitCode;
	const previousArgv = process.argv;
	t.after(() => {
		process.exitCode = previousExitCode;
		process.argv = previousArgv;
	});
	const outcomes: ChildOutcome[] = [
		{ status: 0, signal: null, error: undefined },
		{ status: 1, signal: null, error: undefined },
		{ status: null, signal: 'SIGTERM', error: undefined },
		{ status: null, signal: null, error: new Error(childSecret) },
	];
	for (const [index, outcome] of outcomes.entries()) {
		childOutcome = outcome;
		const output: string[] = [];
		const stdout = mock.method(process.stdout, 'write', (value: string) => {
			output.push(value);
			return true;
		});
		const stderr = mock.method(console, 'error', (value: string) => {
			output.push(value);
		});
		process.argv = ['node', WRAPPER];
		process.exitCode = 0;
		try {
			// A fresh query string re-evaluates the wrapper for every outcome.
			await import(`${pathToFileURL(WRAPPER).href}?outcome=${index}`);
		} finally {
			stdout.mock.restore();
			stderr.mock.restore();
		}
		assert.ok(!output.join('').includes(childSecret));
		// The TAP reporter also writes to stdout from this process; count only wrapper lines.
		const wrapperLines = output.filter((value) => String(value).startsWith('[preview-db]'));
		assert.equal(wrapperLines.length, 1);
		assert.equal(process.exitCode, outcome.status === 0 ? 0 : 1);
	}
});
