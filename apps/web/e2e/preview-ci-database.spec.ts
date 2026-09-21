import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { expect, test } from '@playwright/test';

const SOURCE =
	'postgresql://manawg_preview_ci:synthetic%40pass%3A%25@db.sthiwjebcwwiphashgla.supabase.co:5432/postgres?sslmode=verify-full';

test('Preview CI changes only its transport and preserves encoded credentials and verified TLS', async () => {
	const { previewSessionDatabaseUrl } = await import(
		pathToFileURL(path.resolve(__dirname, '../scripts/db-migrate.mjs')).href
	);
	const source = new URL(SOURCE);
	const result = new URL(previewSessionDatabaseUrl(SOURCE));
	expect(result.hostname).toBe('aws-0-eu-central-1.pooler.supabase.com');
	expect(result.port).toBe('5432');
	expect(result.username).toBe('manawg_preview_ci.sthiwjebcwwiphashgla');
	expect(result.password).toBe(source.password);
	expect(result.pathname).toBe('/postgres');
	expect(result.search).toBe('?sslmode=verify-full');
});

test('Preview CI rejects other projects, roles, transports and driver URL overrides', async () => {
	const { previewSessionDatabaseUrl } = await import(
		pathToFileURL(path.resolve(__dirname, '../scripts/db-migrate.mjs')).href
	);
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
	for (const value of invalid) expect(() => previewSessionDatabaseUrl(value)).toThrow();
});

test('Preview wrapper fails closed without exposing child credentials or error streams', () => {
	const secret = 'SYNTHETIC_CREDENTIAL_MUST_NOT_APPEAR';
	const child = spawnSync(
		process.execPath,
		[path.resolve(__dirname, '../scripts/preview-db-check.mjs')],
		{
			encoding: 'utf8',
			env: {
				...process.env,
				DATABASE_MIGRATION_URL: `postgresql://postgres:${secret}@db.bwsvsvfgbrsonepffqff.supabase.co:5432/postgres?sslmode=verify-full`,
			},
			timeout: 10_000,
		},
	);
	expect(child.error).toBeUndefined();
	expect(child.status).toBe(1);
	expect(child.stdout).toBe('');
	expect(child.stderr.trim()).toBe(
		'[preview-db] migration failed (class=configuration, exit=1, signal=none).',
	);
	expect(child.stderr).not.toContain(secret);
});

test('the ordinary migration entrypoint still rejects session endpoints before connecting', async () => {
	const { previewSessionDatabaseUrl } = await import(
		pathToFileURL(path.resolve(__dirname, '../scripts/db-migrate.mjs')).href
	);
	const child = spawnSync(
		process.execPath,
		[path.resolve(__dirname, '../scripts/db-migrate.mjs'), '--check'],
		{
			encoding: 'utf8',
			env: {
				...process.env,
				DATABASE_MIGRATION_URL: previewSessionDatabaseUrl(SOURCE),
				MANAWG_PREVIEW_CI_SESSION: '',
			},
			timeout: 10_000,
		},
	);
	expect(child.error).toBeUndefined();
	expect(child.status).toBe(1);
	expect(child.stderr).toContain('must be a direct Supabase PostgreSQL connection on port 5432');
});

test('wrapper never forwards secret-bearing child output, including success and process errors', () => {
	const file = path.resolve(__dirname, '../scripts/preview-db-check.mjs');
	const source = readFileSync(file, 'utf8')
		.replace(/^import .*;\n/gm, '')
		.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href));
	const secret = 'SYNTHETIC_CHILD_SECRET';
	for (const outcome of [
		{ status: 0, signal: null, error: undefined },
		{ status: 1, signal: null, error: undefined },
		{ status: null, signal: 'SIGTERM', error: undefined },
		{ status: null, signal: null, error: new Error(secret) },
	]) {
		const output: string[] = [];
		const childProcess = {
			argv: ['node', file],
			execPath: process.execPath,
			env: {},
			exitCode: 0,
			stdout: { write: (value: string) => output.push(value) },
		};
		runInNewContext(source, {
			URL,
			fileURLToPath,
			process: childProcess,
			console: { error: (value: string) => output.push(value) },
			spawnSync: () => ({ ...outcome, stdout: secret, stderr: secret }),
		});
		expect(output.join('')).not.toContain(secret);
		expect(output).toHaveLength(1);
		expect(childProcess.exitCode).toBe(outcome.status === 0 ? 0 : 1);
	}
});
